'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
] as const;

export function PeriodSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get('period') ?? 'month';

  return (
    <select
      aria-label="Period"
      value={current}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('period', e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="rounded-[var(--r)] border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {PERIODS.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
