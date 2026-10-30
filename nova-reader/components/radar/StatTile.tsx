// One headline number on the radar page (Stage 8). Runs in the BROWSER.

type StatTileProps = { label: string; value: string; note?: string };

export function StatTile({ label, value, note }: StatTileProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1.5 font-serif text-3xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
    </div>
  );
}
