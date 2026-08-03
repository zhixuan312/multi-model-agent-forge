'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';

const PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
] as const;

/**
 * Usage period filter. State lives in the URL (shareable, RSC-friendly), like the Loops
 * activity filters.
 *
 * The governed `Select`, not a native `<select>`: this was the one dropdown in the app
 * that rendered the OS control, with its own hand-written border and focus ring, sitting
 * beside toolbars built from Radix triggers.
 */
export function PeriodSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get('period') ?? 'month';

  return (
    <Select
      value={current}
      onValueChange={(v) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('period', v);
        router.push(`${pathname}?${params.toString()}`);
      }}
    >
      <SelectTrigger aria-label="Period" className="w-[10.5rem]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIODS.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
