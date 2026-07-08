/**
 * Minimal self-contained cost sparkline — an accent line over a faint area fill,
 * no charting library. Used by the org usage dashboard for the daily cost trend.
 * Renders nothing when there is no data (the caller shows an empty state).
 */
export function Sparkline({
  points,
  width = 480,
  height = 64,
  label = 'Trend',
}: {
  points: number[];
  width?: number;
  height?: number;
  label?: string;
}) {
  if (points.length === 0) return null;

  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const pad = 3;
  const y = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);

  const coords = points.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`);
  const line = coords.join(' ');
  const area = `0,${height} ${line} ${((points.length - 1) * stepX).toFixed(1)},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-16 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polygon points={area} className="fill-accent/10" />
      <polyline points={line} className="fill-none stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
