// @vitest-environment jsdom
// Unit & UI tests for:
//   1. Seed List Trap Detector & Mentor Report Optimizer (duplicate blog URLs + malformed feeds)
//   2. Zero-PII SHA-256 Blockchain Compliance & Content Provenance Ledger

import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockchainCompliancePanel } from "@/components/BlockchainCompliance";
import { SeedTrapScanner } from "@/components/SeedTrapScanner";
import {
  computeMerkleRoot,
  computeSha256Hex,
  signChainTipWithDeviceKey,
  verifyComplianceChain,
} from "@/lib/blockchain-compliance";
import { appendComplianceEvent, closeDatabase, getComplianceChain } from "@/lib/db";
import {
  buildMentorTrapReport,
  extractSeedUrls,
  finalizeSeedAudit,
  inspectRawFeedXml,
} from "@/lib/seed-auditor";

beforeEach(async () => {
  closeDatabase();
  await Dexie.delete("nova-reader");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Seed List Trap Detector (PECathon +10 pts optimizer)", () => {
  it("extracts seed URLs from OPML, Markdown lists, and plain text", () => {
    const opml = `<?xml version="1.0"?>
      <opml version="2.0">
        <body>
          <outline text="Julia" xmlUrl="https://jvns.ca/atom.xml" />
          <outline text="Julia RSS" xmlUrl="https://jvns.ca/rss.xml" />
        </body>
      </opml>`;
    expect(extractSeedUrls(opml)).toEqual(["https://jvns.ca/atom.xml", "https://jvns.ca/rss.xml"]);

    const md = `
      - [Blog One](https://alpha.example/feed.xml)
      - [Blog Two](https://beta.example/atom.xml)
    `;
    expect(extractSeedUrls(md)).toEqual(["https://alpha.example/feed.xml", "https://beta.example/atom.xml"]);
  });

  it("detects two different feed URLs (RSS + Atom) belonging to the same blog", () => {
    const rssXml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Systems Craft</title>
          <link>https://systemscraft.example/</link>
          <item>
            <title>Zero-Copy Parsers in Rust</title>
            <link>https://systemscraft.example/posts/zero-copy</link>
          </item>
        </channel>
      </rss>`;

    const atomXml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Systems Craft</title>
        <link rel="alternate" href="https://www.systemscraft.example" />
        <entry>
          <id>tag:systemscraft,2026:1</id>
          <title>Zero-Copy Parsers in Rust</title>
          <link rel="alternate" href="https://systemscraft.example/posts/zero-copy/" />
          <updated>2026-10-20T10:00:00Z</updated>
        </entry>
      </feed>`;

    const e1 = inspectRawFeedXml(1, "https://systemscraft.example/rss.xml", rssXml, "https://systemscraft.example/rss.xml");
    const e2 = inspectRawFeedXml(2, "https://systemscraft.example/atom.xml", atomXml, "https://systemscraft.example/atom.xml");
    const summary = finalizeSeedAudit([e1, e2]);

    expect(summary.trapCount).toBe(1);
    expect(summary.traps[0].category).toBe("DUPLICATE_BLOG");
    expect(summary.traps[0].seedIndices).toEqual([1, 2]);
    expect(summary.traps[0].evidence.join(" ")).toContain("RSS 2.0 vs Atom");
  });

  it("pinpoints malformed XML feed traps with exact line and column diagnostics", () => {
    const brokenXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0">',
      "  <channel>",
      "    <title>Broken Trap Blog</title>",
      "    <item>",
      "      <title>Unclosed tag below",
      "    </item>",
      "  </channel>",
      "</rss>",
    ].join("\n");

    const entry = inspectRawFeedXml(3, "https://trap.example/broken.xml", brokenXml, "https://trap.example/broken.xml");
    expect(entry.ok).toBe(false);
    expect(entry.xmlDiagnostic?.line).toBeGreaterThanOrEqual(6);

    const summary = finalizeSeedAudit([entry]);
    expect(summary.traps).toHaveLength(1);
    expect(summary.traps[0].category).toBe("MALFORMED_FEED");
    expect(summary.traps[0].subkind).toBe("INVALID_XML_SYNTAX");

    const report = buildMentorTrapReport(summary, "abc123ledgerhash");
    expect(report).toContain("MALFORMED_FEED");
    expect(report).toContain("Seed #3: https://trap.example/broken.xml");
    expect(report).toContain("Line ");
  });

  it("scans a seed list in SeedTrapScanner UI and displays detected traps", async () => {
    const e1 = inspectRawFeedXml(
      1,
      "https://clean.example/feed.xml",
      `<rss version="2.0"><channel><title>Clean Blog</title><link>https://clean.example</link><item><title>Post 1</title><link>https://clean.example/1</link></item></channel></rss>`,
      "https://clean.example/feed.xml",
    );
    const e2 = inspectRawFeedXml(
      2,
      "https://malformed.example/rss.xml",
      `<rss><channel><title>Oops</channel></rss>`,
      "https://malformed.example/rss.xml",
    );
    const mockSummary = finalizeSeedAudit([e1, e2]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, summary: mockSummary }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const user = userEvent.setup();
    render(<SeedTrapScanner onOpenFeedFromAudit={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Audit seed list" }));
    const textarea = screen.getByLabelText(/Paste seed URLs/i);
    await user.type(textarea, "https://clean.example/feed.xml\nhttps://malformed.example/rss.xml");
    await user.click(screen.getByRole("button", { name: "Scan for Traps" }));

    expect(await screen.findByText(/1 Deliberate Trap Identified/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy Mentor Report/i })).toBeTruthy();
  });
});

describe("Blockchain Compliance & Provenance Ledger", () => {
  it("appends SHA-256 linked blocks, verifies chain integrity, and detects tampering", async () => {
    const merkleRoot = await computeMerkleRoot(["article-1", "article-2"]);
    const payloadHash = await computeSha256Hex("feed-payload");

    await appendComplianceEvent({
      eventType: "FEED_INGESTED",
      subject: "Small Web Feed (2 posts)",
      referenceUrl: "https://smallweb.example/rss.xml",
      merkleRoot,
      payloadHash,
    });

    const chain = await getComplianceChain();
    expect(chain).toHaveLength(2); // Block #0 Genesis + Block #1 FEED_INGESTED
    expect(chain[1].prevHash).toBe(chain[0].blockHash);

    const validCheck = await verifyComplianceChain(chain);
    expect(validCheck.valid).toBe(true);
    expect(validCheck.checkedBlocks).toBe(2);

    // Tamper with Block #1 subject without recomputing blockHash -> verifier catches it!
    const tampered = [chain[0], { ...chain[1], subject: "Tampered Feed Title" }];
    const tamperedCheck = await verifyComplianceChain(tampered);
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.tamperedIndex).toBe(1);

    // Sign chain tip using device ECDSA P-256
    const attestation = await signChainTipWithDeviceKey(chain[1], chain.length);
    expect(attestation.chainTipHash).toBe(chain[1].blockHash);
    expect(attestation.signatureHex.startsWith("0x")).toBe(true);
  });

  it("renders BlockchainCompliancePanel, verifies chain, and signs an ECDSA receipt", async () => {
    const user = userEvent.setup();
    render(<BlockchainCompliancePanel />);

    expect(await screen.findByText("SHA-256 Chain Verified")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Sign ECDSA Receipt/i }));

    await waitFor(() => {
      expect(screen.getByText(/Signed Attestation/i)).toBeTruthy();
    });
  });
});
