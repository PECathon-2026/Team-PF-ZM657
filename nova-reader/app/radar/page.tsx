"use client";
// /radar — Personal Knowledge Radar (Stage 8).
// Runs in the BROWSER only. It reads data that is ALREADY stored on this device
// (IndexedDB: saved articles, offline feed copies, stored full articles),
// calculates a summary with lib/radar.ts, and shows it. The result is not
// stored and nothing is sent to any server.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Radar, RefreshCw, ShieldCheck } from "lucide-react";
import { BarList } from "@/components/radar/BarList";
import { DataTable } from "@/components/radar/DataTable";
import { StatTile } from "@/components/radar/StatTile";
import { WeeklyColumns } from "@/components/radar/WeeklyColumns";
import { StatusMessage } from "@/components/StatusMessage";
import { getSavedArticles, listCachedFeeds, listExtractedArticles } from "@/lib/db";
import { buildRadar, type RadarReport } from "@/lib/radar";

type LoadState = { kind: "loading" } | { kind: "ready"; report: RadarReport } | { kind: "error"; message: string };

async function loadReport(): Promise<LoadState> {
  try {
    const [saved, feeds, extracted] = await Promise.all([getSavedArticles(), listCachedFeeds(), listExtractedArticles()]);
    return { kind: "ready", report: buildRadar({ saved, feeds, extracted, now: new Date() }) };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Local storage could not be read." };
  }
}

const articles = (n: number) => `${n} ${n === 1 ? "article" : "articles"}`;

export default function RadarPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadReport().then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [refreshKey]);

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
              <Radar aria-hidden="true" className="size-5 text-accent" />
              Personal Knowledge Radar
            </h1>
            <p className="mt-0.5 text-sm text-ink-muted">What you have saved and read on this device.</p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-accent hover:text-accent"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to reader
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="flex max-w-2xl items-start gap-2 text-sm text-ink-muted">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Calculated just now in your browser from data already stored on this device. The radar itself is not saved,
            and nothing is sent to any server.
          </p>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-accent hover:text-accent"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </button>
        </div>

        {state.kind === "loading" && <StatusMessage kind="loading" message="Reading your local data…" />}
        {state.kind === "error" && <StatusMessage kind="error" message={state.message} />}
        {state.kind === "ready" && (state.report.isEmpty ? <EmptyRadar /> : <RadarView report={state.report} />)}
      </main>
    </>
  );
}

function EmptyRadar() {
  return (
    <section className="rounded-2xl border border-dashed border-line p-8 text-center">
      <h2 className="text-lg font-semibold text-ink">Nothing to show yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
        Save some articles or open them in the full reading view. The radar only uses what is stored on this device.
      </p>
      <Link href="/" className="mt-4 inline-block font-medium text-accent underline-offset-4 hover:underline">
        Go to the reader
      </Link>
    </section>
  );
}

function RadarView({ report }: { report: RadarReport }) {
  const { totals, depth } = report;
  return (
    <>
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Saved articles" value={String(totals.savedArticles)} />
        <StatTile label="Sources you saved from" value={String(totals.sources)} />
        <StatTile label="Full articles stored" value={String(totals.fullArticles)} note="opened in the reading view" />
        <StatTile
          label="Reading time stored"
          value={depth ? `${depth.estimatedMinutes} min` : "—"}
          note={depth ? `about ${depth.totalWords.toLocaleString()} words at 200 per minute` : "no full articles stored yet"}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Topics in your saved articles" subtitle="Number of saved articles mentioning each topic. Feed categories when the feed is still cached, otherwise frequent words.">
          {report.topics.length === 0 ? (
            <p className="text-sm text-ink-muted">No topics yet — save a few more articles.</p>
          ) : (
            <>
              <BarList
                ariaLabel="Topics in your saved articles"
                unit={articles}
                data={report.topics.map((t) => ({ label: t.label, value: t.count, note: t.kind === "category" ? "category" : undefined }))}
              />
              <DataTable caption="Topics in your saved articles" columns={["Topic", "Saved articles"]} rows={report.topics.map((t) => ({ label: t.label, value: t.count }))} />
            </>
          )}
        </Card>

        <Card title="Where your saved articles come from" subtitle="Saved articles per feed or website.">
          {report.sources.length === 0 ? (
            <p className="text-sm text-ink-muted">No saved articles yet.</p>
          ) : (
            <>
              <BarList ariaLabel="Saved articles per source" unit={articles} data={report.sources.map((s) => ({ label: s.label, value: s.count }))} />
              <DataTable caption="Saved articles per source" columns={["Source", "Saved articles"]} rows={report.sources.map((s) => ({ label: s.label, value: s.count }))} />
            </>
          )}
        </Card>
      </div>

      <Card title="Articles saved per week" subtitle={`The last ${report.savedPerWeek.length} weeks, by the day you pressed Save (weeks start on Monday).`}>
        <WeeklyColumns weeks={report.savedPerWeek} />
        <DataTable
          caption="Articles saved per week"
          columns={["Week of", "Saved"]}
          rows={report.savedPerWeek.map((w) => ({ label: w.label, value: w.count }))}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Languages of stored full articles" subtitle="As declared by each web page.">
          {report.languages.length === 0 ? (
            <p className="text-sm text-ink-muted">No language information stored yet.</p>
          ) : (
            <BarList ariaLabel="Languages of stored full articles" unit={articles} data={report.languages.map((l) => ({ label: l.label, value: l.count }))} />
          )}
        </Card>

        <Card title="What the radar cannot see" subtitle="NOVA Reader does not store these, so they are not counted.">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
            {report.notAvailable.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">Offline feed copies on this device: {totals.storedFeeds} (used only to recover categories).</p>
        </Card>
      </div>
    </>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-label={title}>
      <h2 className="font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-ink-muted">{subtitle}</p>
      {children}
    </section>
  );
}
