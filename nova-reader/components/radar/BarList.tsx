"use client";
// Horizontal bar chart for counts (topics, sources). Stage 8. Runs in the BROWSER.
// One series → one validated colour (--chart-mark), no legend box (the heading
// names it). Value at each bar tip; the whole row is the hover/focus target and
// shows a tooltip. Labels are rendered as text (never as HTML).

import { useState } from "react";

export type BarDatum = { label: string; value: number; note?: string };

type BarListProps = {
  data: BarDatum[];
  unit: (value: number) => string; // e.g. (n) => `${n} articles`
  ariaLabel: string;
};

export function BarList({ data, unit, ariaLabel }: BarListProps) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <ul aria-label={ariaLabel} className="space-y-2">
      {data.map((datum, index) => {
        const width = Math.max(2, (datum.value / max) * 100);
        return (
          <li
            key={datum.label}
            tabIndex={0}
            aria-label={`${datum.label}: ${unit(datum.value)}${datum.note ? ` (${datum.note})` : ""}`}
            onPointerEnter={() => setActive(index)}
            onPointerLeave={() => setActive((current) => (current === index ? null : current))}
            onFocus={() => setActive(index)}
            onBlur={() => setActive((current) => (current === index ? null : current))}
            className="relative grid grid-cols-[minmax(6rem,11rem)_1fr] items-center gap-3 rounded-md py-1 outline-offset-2"
          >
            <span className="truncate text-sm text-ink" title={datum.label}>
              {datum.label}
              {datum.note && <span className="ml-1 text-xs text-ink-muted">· {datum.note}</span>}
            </span>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-3.5 rounded-r-[4px] bg-chart-mark transition-opacity ${active !== null && active !== index ? "opacity-60" : ""}`}
                style={{ width: `${width}%` }}
              />
              <span aria-hidden="true" className="shrink-0 text-xs text-ink-muted tabular-nums">
                {datum.value}
              </span>
            </span>
            {active === index && (
              <span
                role="tooltip"
                className="pointer-events-none absolute top-full left-[11rem] z-10 mt-1 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-sm"
              >
                <strong className="text-ink">{unit(datum.value)}</strong> <span className="text-ink-muted">{datum.label}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
