// One HTTP GET request with strict limits. Does NOT follow redirects.
// Runs on the SERVER only (Node's http/https/zlib modules).
//
// Why not fetch()? Node's built-in fetch does not let us choose the DNS lookup
// used for the connection. node:http does (`lookup` option), which is how we
// pin connections to addresses that ssrf.ts has validated.

import "server-only";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline, type Readable, type Transform } from "node:stream";
import zlib from "node:zlib";
import { FeedRouteError, isTimeoutError } from "./errors";

export type HttpResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer; // empty for redirects
};

export type HttpGetOptions = {
  lookup: LookupFunction; // decides which IP we connect to (see ssrf.ts)
  signal: AbortSignal; // overall deadline, shared by all redirects
  maxBytes: number; // limit for the DECODED body (protects against gzip bombs)
  headers?: Record<string, string>;
};

/** Function type so tests can replace the network with a fake. */
export type Transport = (url: URL, options: HttpGetOptions) => Promise<HttpResponse>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

export const httpGetOnce: Transport = (url, options) => {
  if (options.signal.aborted) return Promise.reject(timeoutError());

  return new Promise<HttpResponse>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(toSafeError(error));
    };

    const request = client.request(url, {
      method: "GET",
      headers: options.headers,
      lookup: options.lookup,
      agent: false, // fresh connection every time: no reuse of sockets from other requests
      signal: options.signal,
    });

    request.on("error", fail);
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;

      if (isRedirectStatus(status)) {
        response.resume(); // ignore the redirect body
        request.destroy();
        settled = true;
        resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
        return;
      }

      readLimitedBody(response, options.maxBytes).then(
        (body) => {
          if (settled) return;
          settled = true;
          resolve({ status, headers: response.headers, body });
        },
        (error: unknown) => {
          request.destroy();
          fail(error);
        },
      );
    });

    request.end();
  });
};

/** Reads (and if needed, decompresses) the body, stopping at `maxBytes`. */
async function readLimitedBody(response: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLargeError();

  const stream = decodeStream(response);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buffer.byteLength;
      if (total > maxBytes) throw tooLargeError();
      chunks.push(buffer);
    }
  } finally {
    if (stream !== response) stream.destroy();
    response.destroy();
  }
  return Buffer.concat(chunks, total);
}

/** Handles Content-Encoding. Unknown encodings are refused rather than guessed. */
function decodeStream(response: http.IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  switch (encoding) {
    case "":
    case "identity":
      return response;
    case "gzip":
    case "x-gzip":
      return decompress(response, zlib.createGunzip());
    case "deflate":
      return decompress(response, zlib.createInflate());
    case "br":
      return decompress(response, zlib.createBrotliDecompress());
    default:
      throw new FeedRouteError("UPSTREAM_ERROR", 502, "The feed server used an unsupported compression format.");
  }
}

/**
 * pipeline() (not .pipe()) so that if the connection fails or times out, the
 * error also reaches the decompressor and the read loop stops instead of hanging.
 */
function decompress(response: http.IncomingMessage, decoder: Transform): Readable {
  return pipeline(response, decoder, () => {
    /* errors are delivered to the read loop through `decoder` */
  });
}

/** Converts any network error into a FeedRouteError without leaking details. */
function toSafeError(error: unknown): FeedRouteError | Error {
  if (error instanceof FeedRouteError) return error; // already safe (e.g. BLOCKED_HOST from lookup)
  if (isTimeoutError(error)) return timeoutError();
  return new FeedRouteError("FETCH_FAILED", 502, "Could not connect to the feed's website.");
}

function timeoutError(): FeedRouteError {
  return new FeedRouteError("TIMEOUT", 504, "The feed took too long to respond.");
}

function tooLargeError(): FeedRouteError {
  return new FeedRouteError("RESPONSE_TOO_LARGE", 413, "The feed is too large (limit is 2 MB).");
}
