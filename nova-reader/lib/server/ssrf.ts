// SSRF protection: decides which network destinations the server may contact.
// Runs on the SERVER only (uses Node's DNS and network modules).
//
// SSRF ("server-side request forgery") means tricking our server into calling
// addresses that only it can reach: localhost, the cloud metadata service,
// private networks... This file blocks those in three layers:
//
//   1. URL check   – Stage 2 validateFeedUrl() + an allowed-ports list.
//   2. IP policy   – only PUBLIC unicast IPv4 / global IPv6 addresses are allowed.
//   3. Pinned DNS  – createPinnedLookup() is given to Node's HTTP client as its
//                    `lookup` function. Node calls it at CONNECT time; it resolves
//                    A + AAAA records, rejects the request if ANY address is not
//                    public, and hands Node only the addresses it just checked.
//                    Because checking and connecting use the same answer, a DNS
//                    server cannot return a safe IP for the check and a private
//                    IP for the connection (DNS rebinding / TOCTOU).
//
// Limits that code alone cannot solve are documented in README → Security.

import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { validateFeedUrl } from "@/lib/validation";
import { FeedRouteError } from "./errors";

/** Ports a feed may use. Blocks scanning of SSH, databases, mail servers, etc. */
export const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

// --- IP policy --------------------------------------------------------------

// IPv4 ranges that are NOT public internet (RFC 6890 special-purpose registry).
const BLOCKED_IPV4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (also Alibaba Cloud metadata 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast 255.255.255.255
];

// IPv6: only global unicast (2000::/3) is allowed, minus these special ranges.
// Everything else (::1, ::, fc00::/7 unique-local, fe80::/10 link-local,
// ff00::/8 multicast, ::ffff:0:0/96 IPv4-mapped, 64:ff9b::/96 NAT64...) is
// outside 2000::/3 and therefore blocked automatically.
const BLOCKED_IPV6_INSIDE_GLOBAL: [string, number][] = [
  ["2001::", 23], // IETF protocol assignments (Teredo 2001::/32, ORCHID, ...)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: embeds an IPv4 address, which could be private
  ["3fff::", 20], // documentation (RFC 9637)
];

const blockedV4 = new BlockList();
for (const [network, prefix] of BLOCKED_IPV4) blockedV4.addSubnet(network, prefix, "ipv4");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [network, prefix] of BLOCKED_IPV6_INSIDE_GLOBAL) blockedV6.addSubnet(network, prefix, "ipv6");

/**
 * True only for public internet addresses.
 * Anything unknown or unparsable (including IPv6 zone IDs like "fe80::1%eth0")
 * is treated as NOT public.
 */
export function isPublicIpAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  if (family === 4) return !blockedV4.check(ip, "ipv4");
  if (family === 6) return globalV6.check(ip, "ipv6") && !blockedV6.check(ip, "ipv6");
  return false;
}

// --- DNS --------------------------------------------------------------------

export type ResolvedAddress = { address: string; family: 4 | 6 };

/** Resolves a hostname to ALL its addresses (A and AAAA records). */
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** Default resolver: the operating system's resolver (getaddrinfo), IPv4 + IPv6. */
export const systemResolver: HostResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, family: 0, verbatim: true });
  return results
    .filter((r) => r.family === 4 || r.family === 6)
    .map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
};

const MAX_ADDRESSES = 32;

/**
 * Resolves `hostname` and returns its addresses ONLY if every one is public.
 * Rejecting when even one record is private stops "mixed" answers such as
 * one public A record plus one private AAAA record.
 * @throws FeedRouteError (FETCH_FAILED or BLOCKED_HOST) with a generic message.
 */
export async function resolvePublicAddresses(hostname: string, resolver: HostResolver): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    if (!isPublicIpAddress(host)) throw blockedError();
    return [{ address: host, family: literalFamily as 4 | 6 }];
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = (await resolver(host)).slice(0, MAX_ADDRESSES);
  } catch {
    throw new FeedRouteError("FETCH_FAILED", 502, "Could not find the feed's website.");
  }
  if (addresses.length === 0) {
    throw new FeedRouteError("FETCH_FAILED", 502, "Could not find the feed's website.");
  }
  if (!addresses.every((a) => isPublicIpAddress(a.address))) throw blockedError();
  return addresses;
}

/**
 * Creates the `lookup` function for Node's http/https request.
 * Node calls it right before opening the TCP connection, so the addresses we
 * validate here are exactly the addresses Node connects to.
 */
export function createPinnedLookup(resolver: HostResolver): LookupFunction {
  return (hostname: string, options: LookupOptions, callback) => {
    resolvePublicAddresses(hostname, resolver).then(
      (addresses) => {
        const wanted = options.family === 4 || options.family === 6 ? options.family : undefined;
        const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
        if (usable.length === 0) {
          callback(new FeedRouteError("FETCH_FAILED", 502, "Could not find the feed's website."), "", 0);
          return;
        }
        if (options.all) {
          const all: LookupAddress[] = usable.map((a) => ({ address: a.address, family: a.family }));
          callback(null, all);
        } else {
          callback(null, usable[0].address, usable[0].family);
        }
      },
      (error: unknown) => {
        const safe =
          error instanceof FeedRouteError
            ? error
            : new FeedRouteError("FETCH_FAILED", 502, "Could not find the feed's website.");
        callback(safe, "", 0);
      },
    );
  };
}

// --- URL policy --------------------------------------------------------------

/**
 * Full URL check used before EVERY request (the first one and each redirect):
 * Stage 2 rules (http/https, no credentials, no localhost/private hostnames),
 * an allowed port, and the IP policy for URLs that contain a literal IP.
 * Returns a parsed URL that is safe to request.
 */
export function assertSafeDestination(rawUrl: string): URL {
  const checked = validateFeedUrl(rawUrl);
  if (!checked.ok) throw new FeedRouteError(checked.code, 400, checked.message);

  const url = new URL(checked.url);
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new FeedRouteError("BLOCKED_HOST", 400, "Feeds must use the standard web ports (80, 443, 8080 or 8443).");
  }
  // Node does not call `lookup` for literal IPs, so check them here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicIpAddress(host)) throw blockedError();
  return url;
}

function blockedError(): FeedRouteError {
  // Deliberately vague: never tell the caller which internal address was found.
  return new FeedRouteError("BLOCKED_HOST", 400, "This address is not allowed. Only public websites can be loaded.");
}
