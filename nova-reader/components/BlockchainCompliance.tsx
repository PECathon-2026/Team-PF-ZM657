"use client";
// Blockchain Compliance & Cryptographic Content Provenance Workspace.
// Provides real SHA-256 hash-chain verification, binary Merkle roots, GDPR Art. 17
// zero-PII local anchoring, Web Crypto ECDSA P-256 signing, optional EIP-191 Web3
// wallet signing, and portable JSON compliance audit receipts.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileKey2,
  Link2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  buildComplianceReceiptJson,
  computeArticleProvenanceHash,
  hasInjectedWeb3Wallet,
  signChainTipWithDeviceKey,
  signChainTipWithWallet,
  verifyComplianceChain,
  type ChainVerificationResult,
} from "@/lib/blockchain-compliance";
import { clearComplianceChain, getComplianceChain } from "@/lib/db";
import type { ComplianceAttestation, ComplianceBlock, ReadableArticle } from "@/lib/feed-types";
import { formatDate } from "@/lib/utils";

const noopSubscribe = () => () => {};

type BlockchainCompliancePanelProps = {
  /** Incremented whenever the parent appends a new compliance block. */
  refreshSignal?: number;
};

export function BlockchainCompliancePanel({ refreshSignal = 0 }: BlockchainCompliancePanelProps) {
  const [blocks, setBlocks] = useState<ComplianceBlock[]>([]);
  const [verification, setVerification] = useState<ChainVerificationResult | null>(null);
  const [attestation, setAttestation] = useState<ComplianceAttestation | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletAvailable = useSyncExternalStore(noopSubscribe, hasInjectedWeb3Wallet, () => false);

  useEffect(() => {
    let active = true;

    getComplianceChain()
      .then(async (chain) => {
        if (!active) return;
        setBlocks(chain);
        const verified = await verifyComplianceChain(chain);
        if (active) setVerification(verified);
      })
      .catch(() => {
        if (active) setError("Local compliance ledger is unavailable in private browsing mode.");
      });

    return () => {
      active = false;
    };
  }, [refreshSignal]);

  async function handleReverify() {
    setIsVerifying(true);
    setError(null);
    try {
      const chain = await getComplianceChain();
      setBlocks(chain);
      const res = await verifyComplianceChain(chain);
      setVerification(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify compliance chain.");
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleSign(mode: "device" | "wallet") {
    const tip = blocks[blocks.length - 1];
    if (!tip) return;
    setIsSigning(true);
    setError(null);
    try {
      const signed =
        mode === "wallet"
          ? await signChainTipWithWallet(tip, blocks.length)
          : await signChainTipWithDeviceKey(tip, blocks.length);
      setAttestation(signed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cryptographic signing was cancelled or failed.");
    } finally {
      setIsSigning(false);
    }
  }

  async function handleExportReceipt() {
    const currentVerification = verification ?? (await verifyComplianceChain(blocks));
    const jsonText = buildComplianceReceiptJson(blocks, currentVerification, attestation);
    const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nova-compliance-ledger-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleResetLedger() {
    setError(null);
    try {
      const fresh = await clearComplianceChain();
      setBlocks(fresh);
      setAttestation(null);
      setVerification(await verifyComplianceChain(fresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset compliance chain.");
    }
  }

  const tipBlock = blocks[blocks.length - 1];
  const isInitialLoading = verification === null && !error;
  const isChainIntact = verification?.valid === true;

  return (
    <section aria-labelledby="blockchain-compliance-title" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="blockchain-compliance-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Link2 aria-hidden="true" className="size-5 text-accent" />
            <span>Blockchain Compliance</span>
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            Zero-PII SHA-256 hash-chain &amp; Merkle provenance ledger (GDPR Art. 17 compliant — hashes only, zero personal data).
          </p>
        </div>
      </div>

      {/* Unboxed typographic status bar (Zero-Pill compliant) */}
      <div className="mt-3 rounded-xl border border-line bg-bg p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 font-semibold ${
              isInitialLoading ? "text-ink-muted" : isChainIntact ? "text-accent" : "text-danger"
            }`}
          >
            {isInitialLoading ? (
              <RefreshCw aria-hidden="true" className="size-4 shrink-0 animate-spin text-accent" />
            ) : isChainIntact ? (
              <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
            )}
            {isInitialLoading
              ? "Initializing SHA-256 chain…"
              : isChainIntact
                ? "SHA-256 Chain Verified"
                : "Chain Integrity Alert"}
          </span>
          <span className="text-ink-muted tabular-nums">
            {blocks.length} {blocks.length === 1 ? "block" : "blocks"} · Tip #{tipBlock?.index ?? 0}
          </span>
        </div>

        {tipBlock && (
          <div className="mt-2 space-y-1 border-t border-line/70 pt-2 font-mono text-[11px] text-ink-muted">
            <div className="truncate" title={tipBlock.blockHash}>
              Tip Hash: <span className="text-ink">{tipBlock.blockHash.slice(0, 22)}…</span>
            </div>
            <div className="truncate" title={tipBlock.merkleRoot}>
              Merkle:   <span className="text-ink">{tipBlock.merkleRoot.slice(0, 22)}…</span>
            </div>
          </div>
        )}

        {!isChainIntact && verification?.reason && (
          <p className="mt-2 text-xs font-medium text-danger">{verification.reason}</p>
        )}
      </div>

      {error && <p className="mt-2.5 text-xs font-medium text-danger">{error}</p>}

      {attestation && (
        <div className="mt-3 rounded-xl border border-accent/40 bg-accent-soft/50 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-2 font-semibold text-ink">
            <ShieldCheck aria-hidden="true" className="size-4 text-accent" />
            <span>Signed Attestation ({attestation.scheme})</span>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-ink-muted" title={attestation.signer}>
            Signer: {attestation.signer}
          </p>
          <p className="truncate font-mono text-[11px] text-ink-muted" title={attestation.signatureHex}>
            Sig: {attestation.signatureHex.slice(0, 28)}…
          </p>
        </div>
      )}

      {/* Action controls */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleReverify()}
          disabled={isVerifying}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-bg px-3 text-xs font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className={`size-3.5 text-accent ${isVerifying ? "animate-spin" : ""}`} />
          Verify Chain
        </button>

        <button
          type="button"
          onClick={() => void handleSign("device")}
          disabled={isSigning || blocks.length === 0}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-50"
        >
          <FileKey2 aria-hidden="true" className="size-3.5" />
          Sign ECDSA Receipt
        </button>

        {walletAvailable && (
          <button
            type="button"
            onClick={() => void handleSign("wallet")}
            disabled={isSigning || blocks.length === 0}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-bg px-3 text-xs font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <Wallet aria-hidden="true" className="size-3.5 text-accent" />
            Sign Wallet (EIP-191)
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleExportReceipt()}
          disabled={blocks.length === 0}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-bg px-3 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <Download aria-hidden="true" className="size-3.5 text-accent" />
          Export JSON
        </button>
      </div>

      {/* Collapsible Ledger Block Explorer */}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs">
        <button
          type="button"
          aria-expanded={showLedger}
          onClick={() => setShowLedger((prev) => !prev)}
          className="font-medium text-ink hover:text-accent"
        >
          {showLedger ? "Hide ledger blocks" : `Inspect ledger blocks (${blocks.length})`}
        </button>

        {blocks.length > 1 && (
          <button
            type="button"
            onClick={() => void handleResetLedger()}
            title="GDPR Art. 17 local erasure: reset hash chain to Genesis"
            className="inline-flex items-center gap-1 text-ink-muted hover:text-danger"
          >
            <RotateCcw aria-hidden="true" className="size-3" />
            Erase chain
          </button>
        )}
      </div>

      {showLedger && (
        <ol className="mt-2.5 max-h-64 space-y-2 overflow-y-auto pr-1 text-xs" aria-label="Compliance hash chain blocks">
          {[...blocks].reverse().map((b) => (
            <li key={b.index} className="rounded-xl border border-line bg-bg p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-ink-muted tabular-nums">
                <span className="font-mono font-semibold text-ink">Block #{b.index} · {b.eventType}</span>
                <span>{formatDate(b.timestamp) ?? b.timestamp.slice(0, 10)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs font-medium text-ink">{b.subject}</p>
              <p className="mt-1 truncate font-mono text-[10px] text-ink-muted" title={`prevHash: ${b.prevHash}`}>
                prev: {b.prevHash.slice(0, 18)}… → hash: {b.blockHash.slice(0, 18)}…
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Compact unboxed SHA-256 content provenance line rendered inside ReaderView. */
export function ArticleProvenanceLine({ article }: { article: ReadableArticle }) {
  const [digest, setDigest] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    computeArticleProvenanceHash(article)
      .then((hash) => {
        if (active) setDigest(hash);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [article]);

  if (!digest) return null;

  async function copyDigest() {
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
      <span className="inline-flex items-center gap-1 font-medium text-ink">
        <ShieldCheck aria-hidden="true" className="size-3.5 text-accent" />
        Provenance SHA-256
      </span>
      <span aria-hidden="true">·</span>
      <code className="font-mono text-[11px] text-ink-muted" title={digest}>
        {digest.slice(0, 20)}…
      </code>
      <button
        type="button"
        onClick={() => void copyDigest()}
        aria-label="Copy article SHA-256 provenance hash"
        className="inline-flex min-h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink hover:border-accent hover:text-accent"
      >
        {copied ? <Check aria-hidden="true" className="size-3 text-accent" /> : <ClipboardCopy aria-hidden="true" className="size-3" />}
        {copied ? "Copied" : "Copy hash"}
      </button>
    </div>
  );
}
