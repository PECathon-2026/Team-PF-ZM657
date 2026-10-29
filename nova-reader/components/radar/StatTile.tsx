// One headline number on the radar page (Stage 8). Runs in the BROWSER.

type StatTileProps = { label: string; value: string; note?: string };

export function StatTile({ label, value, note }: StatTileProps) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
    </div>
  );
}
