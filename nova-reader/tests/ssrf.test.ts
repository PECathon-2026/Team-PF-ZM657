// Tests for lib/server/ssrf.ts (IP policy, DNS validation, pinned lookup).
// No real DNS or network is used: resolvers are fakes. Run with: npm test
import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import { FeedRouteError } from "@/lib/server/errors";
import {
  assertSafeDestination,
  createPinnedLookup,
  isPublicIpAddress,
  resolvePublicAddresses,
  type HostResolver,
  type ResolvedAddress,
} from "@/lib/server/ssrf";

const PUBLIC_V4 = "93.184.215.14";
const PUBLIC_V6 = "2606:2800:21f:cb07:6820:80da:af6b:8b2c";

function fixedResolver(addresses: ResolvedAddress[]): HostResolver {
  return async () => addresses;
}

async function expectRouteError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(FeedRouteError);
  await expect(promise).rejects.toMatchObject({ code });
}

/** Calls a lookup function the way Node does and returns its answer. */
function callLookup(lookup: ReturnType<typeof createPinnedLookup>, host: string, all: boolean, family = 0) {
  return new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup(host, { all, family }, (error, address, fam) => (error ? reject(error) : resolve({ address, family: fam })));
  });
}

describe("isPublicIpAddress", () => {
  it.each([PUBLIC_V4, "8.8.8.8", "1.1.1.1", "172.32.0.1", PUBLIC_V6, "2a00:1450:4001:82b::200e"])(
    "allows public address %s",
    (ip) => expect(isPublicIpAddress(ip)).toBe(true),
  );

  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback range", "127.255.255.254"],
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.20.0.1"],
    ["private 192.168/16", "192.168.0.10"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["Alibaba metadata", "100.100.100.200"],
    ["link-local / AWS+GCP+Azure metadata", "169.254.169.254"],
    ["documentation", "192.0.2.1"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["reserved", "240.0.0.1"],
    ["broadcast", "255.255.255.255"],
  ])("blocks IPv4 %s (%s)", (_label, ip) => expect(isPublicIpAddress(ip)).toBe(false));

  it.each([
    ["loopback", "::1"],
    ["unspecified", "::"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped public (still blocked)", "::ffff:8.8.8.8"],
    ["unique local / AWS IPv6 metadata", "fd00:ec2::254"],
    ["link-local", "fe80::1"],
    ["link-local with zone", "fe80::1%eth0"],
    ["site-local (deprecated)", "fec0::1"],
    ["multicast", "ff02::1"],
    ["NAT64", "64:ff9b::7f00:1"],
    ["documentation", "2001:db8::1"],
    ["Teredo", "2001:0:4136:e378::1"],
    ["6to4", "2002:7f00:1::1"],
    ["bracketed loopback", "[::1]"],
  ])("blocks unsafe IPv6 %s (%s)", (_label, ip) => expect(isPublicIpAddress(ip)).toBe(false));

  it("blocks things that are not IP addresses", () => {
    expect(isPublicIpAddress("example.com")).toBe(false);
    expect(isPublicIpAddress("")).toBe(false);
  });
});

describe("resolvePublicAddresses", () => {
  it("returns A and AAAA records when all are public", async () => {
    const addresses = [
      { address: PUBLIC_V4, family: 4 as const },
      { address: PUBLIC_V6, family: 6 as const },
    ];
    await expect(resolvePublicAddresses("blog.example", fixedResolver(addresses))).resolves.toEqual(addresses);
  });

  it("blocks a hostname if ANY record is private (e.g. public A + private AAAA)", async () => {
    const mixed = fixedResolver([
      { address: PUBLIC_V4, family: 4 },
      { address: "fd12::1", family: 6 },
    ]);
    await expectRouteError(resolvePublicAddresses("sneaky.example", mixed), "BLOCKED_HOST");
  });

  it("blocks hostnames that resolve to loopback or metadata addresses", async () => {
    await expectRouteError(resolvePublicAddresses("a.example", fixedResolver([{ address: "127.0.0.1", family: 4 }])), "BLOCKED_HOST");
    await expectRouteError(resolvePublicAddresses("b.example", fixedResolver([{ address: "169.254.169.254", family: 4 }])), "BLOCKED_HOST");
  });

  it("reports DNS failures and empty answers as FETCH_FAILED without details", async () => {
    const failing: HostResolver = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND internal-name.corp"), { code: "ENOTFOUND" });
    };
    const promise = resolvePublicAddresses("missing.example", failing);
    await expectRouteError(promise, "FETCH_FAILED");
    await expect(promise).rejects.not.toHaveProperty("message", expect.stringContaining("corp"));
    await expectRouteError(resolvePublicAddresses("empty.example", fixedResolver([])), "FETCH_FAILED");
  });

  it("checks IP literals without using DNS", async () => {
    const neverCalled: HostResolver = async () => {
      throw new Error("DNS should not be used");
    };
    await expect(resolvePublicAddresses(PUBLIC_V4, neverCalled)).resolves.toEqual([{ address: PUBLIC_V4, family: 4 }]);
    await expectRouteError(resolvePublicAddresses("[::1]", neverCalled), "BLOCKED_HOST");
  });
});

describe("createPinnedLookup (used by Node at connect time)", () => {
  it("returns only validated addresses, in both lookup modes", async () => {
    const lookup = createPinnedLookup(fixedResolver([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ]));
    await expect(callLookup(lookup, "blog.example", true)).resolves.toEqual({
      address: [
        { address: PUBLIC_V4, family: 4 },
        { address: PUBLIC_V6, family: 6 },
      ],
      family: undefined,
    });
    await expect(callLookup(lookup, "blog.example", false)).resolves.toEqual({ address: PUBLIC_V4, family: 4 });
    await expect(callLookup(lookup, "blog.example", false, 6)).resolves.toEqual({ address: PUBLIC_V6, family: 6 });
  });

  it("stops DNS rebinding: a later private answer is rejected at connect time", async () => {
    let calls = 0;
    const rebinding: HostResolver = async () => {
      calls += 1;
      return [{ address: calls === 1 ? PUBLIC_V4 : "127.0.0.1", family: 4 }];
    };
    const lookup = createPinnedLookup(rebinding);
    await expect(callLookup(lookup, "rebind.example", false)).resolves.toMatchObject({ address: PUBLIC_V4 });
    await expect(callLookup(lookup, "rebind.example", false)).rejects.toMatchObject({ code: "BLOCKED_HOST" });
  });
});

describe("assertSafeDestination", () => {
  it("accepts normal feed URLs, including standard alternative ports", () => {
    expect(assertSafeDestination("https://blog.example/feed").toString()).toBe("https://blog.example/feed");
    expect(assertSafeDestination("http://blog.example:8080/rss").port).toBe("8080");
  });

  it.each([["http://blog.example:22/"], ["http://blog.example:6379/"], ["https://blog.example:3000/feed"]])(
    "blocks non-web ports: %s",
    (url) => expect(() => assertSafeDestination(url)).toThrow(expect.objectContaining({ code: "BLOCKED_HOST" })),
  );

  it.each([["http://[2001:db8::1]/feed"], ["http://[::ffff:7f00:1]/"], ["http://198.18.0.1/"], ["http://224.0.0.1/"]])(
    "blocks unsafe literal IPs that pass the basic Stage 2 check: %s",
    (url) => expect(() => assertSafeDestination(url)).toThrow(expect.objectContaining({ code: "BLOCKED_HOST" })),
  );

  it("still applies Stage 2 rules (protocol, credentials)", () => {
    expect(() => assertSafeDestination("ftp://blog.example/")).toThrow(expect.objectContaining({ code: "UNSUPPORTED_PROTOCOL" }));
    expect(() => assertSafeDestination("https://u:p@blog.example/")).toThrow(expect.objectContaining({ code: "INVALID_URL" }));
  });
});
