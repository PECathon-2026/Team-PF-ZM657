// Fake DNS + network for server route tests. The fake transport calls the REAL
// pinned `lookup` before "connecting", exactly like Node's HTTP client, so the
// SSRF checks run for real. No internet is used.
import { isIP } from "node:net";
import type { HttpGetOptions, HttpResponse, Transport } from "@/lib/server/http-client";
import type { HostResolver, ResolvedAddress } from "@/lib/server/ssrf";

export const PUBLIC_IP = "93.184.215.14";

export type FakeReply = Partial<HttpResponse> | ((url: URL, options: HttpGetOptions) => Promise<Partial<HttpResponse>>);

export function fakeInternet(replies: Record<string, FakeReply>, dns: Record<string, ResolvedAddress[]> = {}) {
  const requested: string[] = [];
  const seenOptions: HttpGetOptions[] = [];
  const resolver: HostResolver = async (host) => dns[host] ?? [{ address: PUBLIC_IP, family: 4 }];

  const transport: Transport = async (url, options) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) === 0) {
      await new Promise<void>((resolve, reject) =>
        options.lookup(host, { all: true }, (error) => (error ? reject(error) : resolve())),
      );
    }
    requested.push(url.toString());
    seenOptions.push(options);
    const reply = replies[url.toString()];
    if (!reply) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    const partial = typeof reply === "function" ? await reply(url, options) : reply;
    return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.alloc(0), ...partial };
  };
  return { resolver, transport, requested, seenOptions };
}
