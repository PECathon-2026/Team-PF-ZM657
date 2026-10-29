"use client";
// Column chart: articles saved per week (Stage 8). Runs in the BROWSER.
// SVG with a single validated colour, 1px recessive gridlines, 4px rounded tops,
// square at the baseline, columns ≤ 24px. Values are labelled only on the latest
// week and the busiest week; every column has a hover/focus tooltip, and the
// table view below the chart lists all values.

import { useEffect, useRef, useState } from "react";
import type { WeekItem } from "@/lib/radar";

const DEFAULT_WIDTH = 560; // before the container is measured (and in tests)
const HEIGHT = 200;
const PAD = { top: 22, right: 8, bottom: 28, left: 28 };

export function WeeklyColumns({ weeks }: { weeks: WeekItem[] }) {
  const [active, setActive] = useState<number | null>(null);
  // Draw at the container's real pixel width, so 11px text stays 11px on
  // phones and on wide screens (a scaled viewBox would shrink or blow it up).
  const containerRef = useRef<HTMLDivElement>(null);
  const [WIDTH, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const top = niceMax(max);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / weeks.length;
  const barW = Math.min(24, band * 0.6);
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;
  const busiest = weeks.reduce((best, w, i) => (w.count > weeks[best].count ? i : best), 0);
  const labelled = new Set([weeks.length - 1, ...(weeks[busiest].count > 0 ? [busiest] : [])]);

  return (
    <div ref={containerRef} className="relative">
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Articles saved per week, last ${weeks.length} weeks: ${weeks.map((w) => `${w.label} ${w.count}`).join(", ")}`}
        className="block max-w-full overflow-visible"
      >
        {[0, top / 2, top].map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)">
              {Number.isInteger(tick) ? tick : ""}
            </text>
          </g>
        ))}

        {weeks.map((week, i) => {
          const cx = PAD.left + band * i + band / 2;
          const h = Math.max(0, y(0) - y(week.count));
          return (
            <g
              key={week.weekStart}
              tabIndex={0}
              role="img"
              aria-label={`Week of ${week.label}: ${week.count} saved`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive((c) => (c === i ? null : c))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((c) => (c === i ? null : c))}
              className="outline-none"
            >
              {/* Hit target: the whole band, taller than the mark. */}
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" />
              {h > 0 && <path d={columnPath(cx - barW / 2, y(week.count), barW, h)} fill="var(--chart-mark)" opacity={active !== null && active !== i ? 0.6 : 1} />}
              {active === i && <rect x={PAD.left + band * i + 1} y={PAD.top} width={band - 2} height={plotH} fill="none" stroke="var(--accent)" strokeWidth={1} rx={4} />}
              {labelled.has(i) && (
                <text x={cx} y={y(week.count) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
                  {week.count}
                </text>
              )}
              <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
                {week.label}
              </text>
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <p role="tooltip" className="pointer-events-none absolute top-0 right-0 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-sm">
          <strong className="text-ink">{weeks[active].count} saved</strong>{" "}
          <span className="text-ink-muted">week of {weeks[active].label}</span>
        </p>
      )}
    </div>
  );
}

/** Rounded top (4px), square bottom at the baseline. */
function columnPath(x: number, yTop: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z`;
}

/** A clean axis maximum: 1, 2, 4, 6, 8, 10, 15, 20, 30, ... */
function niceMax(max: number): number {
  const steps = [1, 2, 4, 6, 8, 10, 15, 20, 30, 40, 50, 75, 100];
  return steps.find((s) => s >= max) ?? Math.ceil(max / 50) * 50;
}
