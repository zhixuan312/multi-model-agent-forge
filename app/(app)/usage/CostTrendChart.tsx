'use client';

import { useEffect, useRef, useState, useId } from 'react';
import { formatCost } from '@/usage/format';

export interface CostTrendPoint {
  date: string;
  costUsd: number;
  savedUsd: number;
  count: number;
}

/** Pick a rounded axis maximum + step so the $ gridlines land on clean numbers. */
function niceScale(rawMax: number, targetTicks = 4): { max: number; step: number } {
  if (rawMax <= 0) return { max: 1, step: 1 };
  const rawStep = rawMax / targetTicks;
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const norm = rawStep / base;
  const step = norm < 1.5 ? base : norm < 3 ? 2 * base : norm < 7 ? 5 * base : 10 * base;
  return { max: Math.ceil(rawMax / step) * step, step };
}

/**
 * Forge-themed daily cost + volume chart (org usage). Volume (dispatches) reads
 * as faint accent bars; spend is an ember area+line; savings a sage dashed line.
 * Hairline gridlines + a $ axis + date ticks; hover reveals a per-day tooltip.
 * Hand-drawn SVG (no chart lib) so it inherits the app's warm palette and theme.
 */
export function CostTrendChart({ points, height = 200 }: { points: CostTrendPoint[]; height?: number }) {
  const gradId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(240, e.contentRect.width));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) {
    return (
      <div
        ref={ref}
        className="flex items-center justify-center rounded-md border border-dashed border-line text-sm text-ink-faint"
        style={{ height }}
      >
        Daily spend appears here once there are at least two days of activity.
      </div>
    );
  }

  const padL = 48;
  const padR = 16;
  const padT = 14;
  const padB = 26;
  const innerW = Math.max(20, w - padL - padR);
  const innerH = height - padT - padB;

  const { max: maxCost, step } = niceScale(Math.max(1, ...points.map((p) => p.costUsd)));
  const maxCount = Math.max(1, ...points.map((p) => p.count));

  const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / maxCost) * innerH;

  const costLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.costUsd).toFixed(1)}`).join(' ');
  const costArea = `${costLine} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const savedLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.savedUsd).toFixed(1)}`).join(' ');

  const yTicks: number[] = [];
  for (let v = 0; v <= maxCost + step / 2; v += step) yTicks.push(v);

  // Label every day when the series is short, otherwise thin to ~6 evenly-spaced.
  const xTickIdx =
    points.length <= 8
      ? points.map((_, i) => i)
      : Array.from(new Set([0, ...Array.from({ length: 4 }, (_, k) => Math.round(((k + 1) * (points.length - 1)) / 5)), points.length - 1]));

  const stepX = innerW / (points.length - 1);
  const barW = Math.min(38, Math.max(8, stepX * 0.5));
  // Dispatch-volume bars live in a strip along the base so they read as a
  // separate metric instead of competing with the $ cost line above.
  const bandH = innerH * 0.34;

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let nearest = 0;
    let dmin = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < dmin) {
        dmin = d;
        nearest = i;
      }
    });
    setHover(nearest);
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="w-full">
      <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)} onMouseMove={onMove}>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Daily cost and dispatch volume">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* gridlines + $ axis labels */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={w - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth="1"
              strokeDasharray={i === 0 ? '0' : '2,3'}
            />
            <text x={padL - 8} y={y(v) + 3} textAnchor="end" className="fill-ink-faint" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
              ${v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v}
            </text>
          </g>
        ))}

        {/* dispatch-volume bars — a strip along the base */}
        {points.map((p, i) => {
          const barH = (p.count / maxCount) * bandH;
          return (
            <rect
              key={i}
              data-role="volume-bar"
              x={x(i) - barW / 2}
              y={padT + innerH - barH}
              width={barW}
              height={Math.max(0.5, barH)}
              rx="1.5"
              fill="var(--steel)"
              opacity={hover === i ? 0.38 : 0.2}
            />
          );
        })}

        {/* spend area + line */}
        <path d={costArea} fill={`url(#${gradId})`} />
        <path d={costLine} data-role="cost-line" fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {/* savings line */}
        <path d={savedLine} data-role="saved-line" fill="none" stroke="var(--sage)" strokeWidth="1.6" strokeDasharray="4,3" vectorEffect="non-scaling-stroke" opacity="0.9" />

        {/* x-axis date ticks */}
        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-ink-faint" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
            {points[i].date.slice(5)}
          </text>
        ))}

        {/* hover crosshair + markers */}
        {hover !== null && hp && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--line-strong)" strokeDasharray="2,3" />
            <circle cx={x(hover)} cy={y(hp.costUsd)} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
            <circle cx={x(hover)} cy={y(hp.savedUsd)} r="3" fill="var(--sage)" stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: Math.min(w - 150, Math.max(0, x(hover) + 10)), top: padT }}
        >
          <div className="mb-0.5 font-medium tabular-nums text-ink">{hp.date}</div>
          <div className="flex items-center justify-between gap-3 text-ink-soft">
            <span style={{ color: 'var(--accent)' }}>Spent</span>
            <b className="tabular-nums text-ink">{formatCost(hp.costUsd)}</b>
          </div>
          <div className="flex items-center justify-between gap-3 text-ink-soft">
            <span style={{ color: 'var(--sage)' }}>Saved</span>
            <b className="tabular-nums text-ink">{formatCost(hp.savedUsd || null)}</b>
          </div>
          <div className="flex items-center justify-between gap-3 text-ink-soft">
            <span style={{ color: 'var(--steel)' }}>Dispatches</span>
            <b className="tabular-nums text-ink">{hp.count}</b>
          </div>
        </div>
      )}
      </div>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-soft">
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 rounded-full" style={{ background: 'var(--accent)' }} /> Spent</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 rounded-full" style={{ background: 'var(--sage)' }} /> Saved</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2 rounded-[1px]" style={{ background: 'var(--steel)', opacity: 0.35 }} /> Dispatches</span>
      </div>
    </div>
  );
}
