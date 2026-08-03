export function formatCost(usd: number | null): string {
  if (usd === null) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) {
    // Rounding to whole thousands can reach 1000K (999_999 does); that reads as 1.0M.
    const thousands = Math.round(n / 1_000);
    return thousands >= 1_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${thousands}K`;
  }
  return n.toLocaleString();
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = totalMinutes / 60;
  return `${hours.toFixed(1)}h`;
}

export function formatRoi(saved: number | null, actual: number | null): string {
  if (saved === null || actual === null || actual === 0) return '—';
  const roi = (saved + actual) / actual;
  return `${roi.toFixed(1)}×`;
}
