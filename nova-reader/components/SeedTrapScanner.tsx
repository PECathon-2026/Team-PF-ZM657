"use client";
// Seed List Trap Scanner & Mentor Report Optimizer.
// Purpose-built for the PECathon bonus challenge:
//   "The seed list contains one deliberate trap (two URLs for the same blog, or a
//    malformed feed). The first team to detect it and report it to the mentors earns 10 extra points."

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FileUp,
  LoaderCircle,
  NotebookPen,
  Radar,
  Rss,
  ShieldAlert,
} from "lucide-react";
import { computeMerkleRoot, computeSha256Hex } from "@/lib/blockchain-compliance";
import { appendComplianceEvent, cacheFeed, saveNote } from "@/lib/db";
import type { FeedInfo, FeedItem } from "@/lib/feed-types";
import {
  buildMentorTrapReport,
  extractSeedUrls,
  type AuditedSeedEntry,
  type DetectedSeedTrap,
  type SeedAuditSummary,
} from "@/lib/seed-auditor";

type SeedTrapScannerProps = {
  /** Triggered when the user clicks "Open in Reader" on any healthy feed in the seed list. */
  onOpenFeedFromAudit: (url: string, feed: FeedInfo, items: FeedItem[]) => void;
  /** Optional passive trap detected during single-URL feed loading in FeedForm. */
  passiveTrap?: DetectedSeedTrap | null;
  onDismissPassiveTrap?: () => void;
  /** Callbacks to refresh parent notes & compliance ledger state. */
  onNotesChanged?: () => void;
  onComplianceUpdated?: () => void;
};

export function SeedTrapScanner({
  onOpenFeedFromAudit,
  passiveTrap,
  onDismissPassiveTrap,
  onNotesChanged,
  onComplianceUpdated,
}: SeedTrapScannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawSeedInput, setRawSeedInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanElapsedMs, setScanElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<SeedAuditSummary | null>(null);
  const [ledgerBlockHash, setLedgerBlockHash] = useState<string | undefined>(undefined);
  const [copiedReport, setCopiedReport] = useState(false);
  const [savedReport, setSavedReport] = useState(false);
  const [copiedPassive, setCopiedPassive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const detectedUrlCount = extractSeedUrls(rawSeedInput).length;

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRawSeedInput(text);
      setError(null);
      setExpanded(true);
    } catch {
      setError("Could not read the selected seed file.");
    } finally {
      event.target.value = "";
    }
  }

  async function runSeedAudit(urlsToScan: string[]) {
    if (urlsToScan.length === 0) {
      setError("Paste at least one feed URL, Markdown list, JSON array, or OPML file to scan.");
      return;
    }

    setIsScanning(true);
    setError(null);
    setCopiedReport(false);
    setSavedReport(false);
    const t0 = performance.now();

    try {
      const response = await fetch("/api/audit-seeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: urlsToScan }),
      });

      const data = (await response.json()) as
        | { success: true; summary: SeedAuditSummary }
        | { success: false; error?: { message?: string } };

      setScanElapsedMs(Math.round(performance.now() - t0));

      if (!response.ok || !data.success) {
        setError(
          (!data.success && data.error?.message) || "Seed list audit failed. Check your connection and try again.",
        );
        setIsScanning(false);
        return;
      }

      const summary = data.summary;
      setAudit(summary);

      // Cache up to 5 healthy feeds locally right away for instant offline access
      const healthyEntries = summary.entries.filter(
        (e): e is AuditedSeedEntry & { feed: FeedInfo; items: FeedItem[] } => Boolean(e.ok && e.feed && e.items),
      );
      for (const entry of healthyEntries.slice(0, 5)) {
        await cacheFeed(entry.inputUrl, entry.feed, entry.items).catch(() => {});
      }

      // Anchor cryptographic proof of this seed-list audit into the local Blockchain Compliance ledger
      try {
        const leaves = summary.traps.length > 0
          ? summary.traps.map((t) => `${t.category}:${t.subkind}:${t.urls.join(",")}`)
          : summary.entries.map((e) => `${e.seedIndex}:${e.inputUrl}:${e.xmlSha256 ?? e.errorCode ?? "ok"}`);
        const merkleRoot = await computeMerkleRoot(leaves);
        const payloadHash = await computeSha256Hex(summary.auditSha256);
        const block = await appendComplianceEvent({
          eventType: "SEED_TRAP_AUDIT",
          subject: `Seed Audit: ${summary.totalSubmitted} URLs (${summary.trapCount} trap${summary.trapCount === 1 ? "" : "s"})`,
          merkleRoot,
          payloadHash,
        });
        setLedgerBlockHash(block.blockHash);
        onComplianceUpdated?.();
      } catch {
        // IndexedDB blocked in private mode; audit results still display
      }
    } catch {
      setError("Network error while auditing seed list.");
    } finally {
      setIsScanning(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const urls = extractSeedUrls(rawSeedInput);
    void runSeedAudit(urls);
  }

  async function copyMentorReport() {
    if (!audit) return;
    const text = buildMentorTrapReport(audit, ledgerBlockHash);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedReport(true);
      window.setTimeout(() => setCopiedReport(false), 2600);
    } catch {
      setError("Clipboard access was blocked by the browser. Save the report to Notes instead.");
    }
  }

  async function saveMentorReportToNotes() {
    if (!audit) return;
    const text = buildMentorTrapReport(audit, ledgerBlockHash);
    try {
      await saveNote({
        title: `Mentor Trap Report (${audit.trapCount} trap${audit.trapCount === 1 ? "" : "s"} found)`,
        content: text,
      });
      setSavedReport(true);
      onNotesChanged?.();
    } catch {
      setError("Could not save trap report to local notes.");
    }
  }

  async function copyPassiveTrapReport() {
    if (!passiveTrap) return;
    const syntheticSummary: SeedAuditSummary = {
      auditedAt: new Date().toISOString(),
      totalSubmitted: passiveTrap.urls.length,
      healthyCount: 0,
      trapCount: 1,
      auditSha256: passiveTrap.id,
      entries: [],
      traps: [passiveTrap],
    };
    const report = buildMentorTrapReport(syntheticSummary);
    try {
      await navigator.clipboard.writeText(report);
      setCopiedPassive(true);
      window.setTimeout(() => setCopiedPassive(false), 2500);
    } catch {
      // ignore clipboard restriction
    }
  }

  return (
    <div className="space-y-3">
      {/* Live single-URL passive trap alert (triggers automatically even without opening batch scanner) */}
      {passiveTrap && (
        <section
          aria-label="Detected feed trap alert"
          className="rounded-2xl border border-danger/60 bg-danger-soft p-4 text-sm text-ink"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold text-danger">
                <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
                <span>Seed Trap Detected — {passiveTrap.category === "DUPLICATE_BLOG" ? "Duplicate Blog URLs" : "Malformed Feed"}</span>
              </p>
              <p className="mt-1 font-serif text-base font-semibold text-ink">{passiveTrap.headline}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-ink-muted">
                {passiveTrap.evidence.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copyPassiveTrapReport()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
              >
                {copiedPassive ? <Check aria-hidden="true" className="size-3.5" /> : <ClipboardCopy aria-hidden="true" className="size-3.5" />}
                {copiedPassive ? "Mentor Report Copied" : "Copy Mentor Report"}
              </button>
              {onDismissPassiveTrap && (
                <button
                  type="button"
                  onClick={onDismissPassiveTrap}
                  className="inline-flex min-h-10 items-center rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink hover:border-accent"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Batch Seed List Trap Scanner */}
      <section aria-labelledby="seed-trap-scanner-heading" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="seed-trap-scanner-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
              <Radar aria-hidden="true" className="size-4 text-accent" />
              <span>Seed List Trap Scanner</span>
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Bulk-audit an entire seed list or OPML file in parallel to catch duplicate blogs (RSS/Atom aliases, redirects, shared posts) and malformed XML feeds with exact line &amp; column proof.
            </p>
          </div>

          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-bg px-3.5 py-2 text-xs font-semibold text-ink hover:border-accent hover:text-accent"
          >
            {expanded ? "Hide scanner" : "Audit seed list"}
          </button>
        </div>

        {expanded && (
          <div className="mt-4 space-y-4 border-t border-line pt-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="seed-list-textarea" className="text-xs font-semibold text-ink">
                  Paste seed URLs, Markdown list, JSON array, or OPML XML
                  {detectedUrlCount > 0 ? (
                    <span className="ml-2 font-normal text-ink-muted tabular-nums">
                      · {detectedUrlCount} {detectedUrlCount === 1 ? "URL" : "URLs"} detected
                    </span>
                  ) : null}
                </label>

                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".opml,.xml,.txt,.md,.csv,.json"
                    onChange={(e) => void handleFileUpload(e)}
                    className="sr-only"
                    id="seed-file-upload"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-bg px-3 text-xs font-medium text-ink hover:border-accent hover:text-accent"
                  >
                    <FileUp aria-hidden="true" className="size-3.5 text-accent" />
                    Import OPML / .txt / .json
                  </button>
                </div>
              </div>

              <textarea
                id="seed-list-textarea"
                rows={5}
                value={rawSeedInput}
                onChange={(e) => {
                  setRawSeedInput(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={"https://blog.example.com/rss.xml\nhttps://blog.example.com/atom.xml\nhttps://broken.example.org/feed.xml"}
                spellCheck={false}
                className="w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-muted/65 focus:border-accent"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-muted">
                  Scans up to 60 URLs concurrently with SSRF protection &amp; SHA-256 compliance notarization.
                </p>
                <div className="flex items-center gap-2">
                  {rawSeedInput.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setRawSeedInput("");
                        setAudit(null);
                        setError(null);
                      }}
                      className="inline-flex min-h-10 items-center rounded-xl border border-line px-3 text-xs font-medium text-ink hover:border-accent"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isScanning || detectedUrlCount === 0}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isScanning ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Radar aria-hidden="true" className="size-4" />
                    )}
                    {isScanning ? "Scanning seed list…" : "Scan for Traps"}
                  </button>
                </div>
              </div>
            </form>

            {error && <p className="text-xs font-medium text-danger">{error}</p>}

            {audit && (
              <div className="space-y-4 border-t border-line pt-4">
                {/* Unboxed typographic summary metadata (Zero-Pill compliant) */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted tabular-nums">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-ink">{audit.totalSubmitted} seeds audited</span>
                    <span aria-hidden="true">·</span>
                    <span>{audit.healthyCount} clean</span>
                    <span aria-hidden="true">·</span>
                    <span className={audit.trapCount > 0 ? "font-semibold text-danger" : "text-accent"}>
                      {audit.trapCount} {audit.trapCount === 1 ? "trap flagged" : "traps flagged"}
                    </span>
                    {scanElapsedMs !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{scanElapsedMs} ms</span>
                      </>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-ink-muted" title={`Audit SHA-256: ${audit.auditSha256}`}>
                    SHA-256 {audit.auditSha256.slice(0, 14)}…
                  </span>
                </div>

                {/* Highlighted Trap Findings + 1-Click Mentor Report */}
                {audit.traps.length > 0 ? (
                  <div className="space-y-3 rounded-xl border border-danger/55 bg-danger-soft/75 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
                        <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
                        <span>
                          {audit.traps.length === 1 ? "1 Deliberate Trap Identified" : `${audit.traps.length} Traps Identified`} — Ready for Mentor Submission
                        </span>
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void copyMentorReport()}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                        >
                          {copiedReport ? (
                            <Check aria-hidden="true" className="size-3.5" />
                          ) : (
                            <ClipboardCopy aria-hidden="true" className="size-3.5" />
                          )}
                          {copiedReport ? "Mentor Report Copied!" : "Copy Mentor Report"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveMentorReportToNotes()}
                          disabled={savedReport}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink hover:border-accent disabled:opacity-70"
                        >
                          {savedReport ? (
                            <Check aria-hidden="true" className="size-3.5 text-accent" />
                          ) : (
                            <NotebookPen aria-hidden="true" className="size-3.5 text-accent" />
                          )}
                          {savedReport ? "Saved to Notes" : "Save Report to Notes"}
                        </button>
                      </div>
                    </div>

                    <ul className="space-y-2.5">
                      {audit.traps.map((trap) => (
                        <li key={trap.id} className="rounded-xl border border-line bg-surface p-3.5 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-danger">
                            <span>{trap.category === "DUPLICATE_BLOG" ? "Duplicate Blog Trap" : "Malformed Feed Trap"}</span>
                            <span aria-hidden="true">·</span>
                            <span>{trap.subkind.replace(/_/g, " ")}</span>
                            <span aria-hidden="true">·</span>
                            <span>Seeds {trap.seedIndices.map((n) => `#${n}`).join(" & ")}</span>
                          </div>
                          <p className="mt-1 font-serif text-sm font-semibold text-ink">{trap.headline}</p>
                          <div className="mt-1.5 space-y-0.5 font-mono text-[11px] text-ink">
                            {trap.urls.map((u, idx) => (
                              <div key={`${trap.id}-${u}-${idx}`} className="break-all">
                                #{trap.seedIndices[idx] ?? idx + 1}: {u}
                              </div>
                            ))}
                          </div>
                          <ul className="mt-2 space-y-1 border-t border-line/70 pt-2 text-ink-muted">
                            {trap.evidence.map((ev) => (
                              <li key={ev} className="break-words">
                                • {ev}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 rounded-xl border border-line bg-bg p-3 text-xs text-ink">
                    <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-accent" />
                    <span>All {audit.totalSubmitted} seed URLs parsed cleanly with distinct blog identities.</span>
                  </p>
                )}

                {/* Audited Seed Feed Directory (one-click load into NOVA Reader) */}
                <div>
                  <h3 className="text-xs font-semibold text-ink-muted">Audited seed endpoints</h3>
                  <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {audit.entries.map((entry) => (
                      <li
                        key={`${entry.seedIndex}-${entry.inputUrl}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 text-ink">
                            <span className="font-mono text-ink-muted tabular-nums">#{entry.seedIndex}</span>
                            <span className="truncate font-semibold">
                              {entry.ok && entry.feed ? entry.feed.title : entry.errorCode ?? "FAILED"}
                            </span>
                            {entry.format && entry.format !== "Unknown" && (
                              <>
                                <span aria-hidden="true" className="text-ink-muted">·</span>
                                <span className="text-ink-muted">{entry.format}</span>
                              </>
                            )}
                            {entry.ok && entry.items && (
                              <>
                                <span aria-hidden="true" className="text-ink-muted">·</span>
                                <span className="text-ink-muted tabular-nums">{entry.items.length} posts</span>
                              </>
                            )}
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">{entry.inputUrl}</p>
                        </div>

                        {entry.ok && entry.feed && entry.items ? (
                          <button
                            type="button"
                            onClick={() => onOpenFeedFromAudit(entry.inputUrl, entry.feed!, entry.items!)}
                            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent"
                          >
                            <Rss aria-hidden="true" className="size-3.5 text-accent" />
                            Open feed
                          </button>
                        ) : (
                          <span className="text-[11px] font-medium text-danger">Trap / Invalid</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
