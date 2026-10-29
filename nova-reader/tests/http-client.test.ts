// Tests for lib/server/http-client.ts using a REAL local HTTP server.
//
// The local server listens on 127.0.0.1, which our SSRF policy blocks. To test
// the HTTP mechanics (timeouts, size limits, compression) we pass a test-only
// lookup that points to 127.0.0.1. The final test uses the REAL pinned lookup
// and proves the server never receives the request.
import http from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpGetOnce } from "@/lib/server/http-client";
import { createPinnedLookup } from "@/lib/server/ssrf";

let server: http.Server;
let port = 0;
let hits = 0;

const toLocalhost: LookupFunction = (_hostname, options, callback) => {
  if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
  else callback(null, "127.0.0.1", 4);
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    const path = req.url ?? "/";
    if (path === "/ok") {
      res.writeHead(200, { "content-type": "application/rss+xml" }).end("<rss/>");
    } else if (path === "/gzip") {
      res.writeHead(200, { "content-type": "application/rss+xml", "content-encoding": "gzip" });
      res.end(zlib.gzipSync("<rss>compressed</rss>"));
    } else if (path === "/gzip-bomb") {
      // ~10 KB compressed, 20 MB when decompressed.
      res.writeHead(200, { "content-type": "application/rss+xml", "content-encoding": "gzip" });
      res.end(zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20)));
    } else if (path === "/declared-big") {
      res.writeHead(200, { "content-type": "application/rss+xml", "content-length": String(5 * 1024 * 1024) });
      res.write("<rss>"); // never finishes; client must stop on the header
    } else if (path === "/stream-big") {
      res.writeHead(200, { "content-type": "application/rss+xml" }); // no content-length
      const chunk = Buffer.alloc(64 * 1024, 0x20);
      let sent = 0;
      const pump = () => {
        while (sent < 4 * 1024 * 1024 && res.write(chunk)) sent += chunk.length;
        if (sent < 4 * 1024 * 1024) res.once("drain", pump);
        else res.end();
      };
      pump();
    } else if (path === "/slow") {
      res.writeHead(200, { "content-type": "application/rss+xml" });
      res.write("<rss>"); // then hangs
    } else if (path === "/redirect") {
      res.writeHead(302, { location: "/ok" }).end("moved");
    } else if (path === "/weird-encoding") {
      res.writeHead(200, { "content-type": "application/rss+xml", "content-encoding": "compress" }).end("x");
    } else {
      res.writeHead(404).end("missing");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function get(path: string, { timeoutMs = 2000, maxBytes = 2 * 1024 * 1024, lookup = toLocalhost } = {}) {
  return httpGetOnce(new URL(`http://feed.test:${port}${path}`), {
    lookup,
    signal: AbortSignal.timeout(timeoutMs),
    maxBytes,
    headers: { "user-agent": "test" },
  });
}

describe("httpGetOnce", () => {
  it("returns status, headers and body", async () => {
    const res = await get("/ok");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/rss+xml");
    expect(res.body.toString()).toBe("<rss/>");
  });

  it("decompresses gzip", async () => {
    expect((await get("/gzip")).body.toString()).toBe("<rss>compressed</rss>");
  });

  it("does not follow redirects itself (the caller validates each hop)", async () => {
    const res = await get("/redirect");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/ok");
    expect(res.body.length).toBe(0);
  });

  it("returns non-2xx statuses for the caller to handle", async () => {
    expect((await get("/nope")).status).toBe(404);
  });

  it("rejects a response whose Content-Length is too big", async () => {
    await expect(get("/declared-big")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("stops reading a streamed response once it passes the limit", async () => {
    await expect(get("/stream-big")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("stops a gzip bomb (limit applies to the decompressed size)", async () => {
    await expect(get("/gzip-bomb")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("times out on a server that stops sending", async () => {
    const started = Date.now();
    await expect(get("/slow", { timeoutMs: 300 })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses unknown content encodings", async () => {
    await expect(get("/weird-encoding")).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("reports connection failures as FETCH_FAILED", async () => {
    const refused: LookupFunction = (_h, options, callback) => {
      if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
      else callback(null, "127.0.0.1", 4);
    };
    const url = new URL("http://feed.test:1/ok"); // nothing listens on port 1
    await expect(
      httpGetOnce(url, { lookup: refused, signal: AbortSignal.timeout(2000), maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: "FETCH_FAILED" });
  });

  it("with the REAL pinned lookup, a hostname resolving to 127.0.0.1 never reaches the server", async () => {
    const before = hits;
    const pinned = createPinnedLookup(async () => [{ address: "127.0.0.1", family: 4 }]);
    await expect(get("/ok", { lookup: pinned })).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    expect(hits).toBe(before);
  });
});
