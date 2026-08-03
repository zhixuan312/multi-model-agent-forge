'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { PERIODS, PERIOD_LABEL, parsePeriod } from '@/usage/period';

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
  // Through the same parser the pages use, so the picker can never show a value the
  // page would reject (or default differently from it).
  const current = parsePeriod(searchParams.get('period'));

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
          <SelectItem key={p} value={p}>
            {PERIOD_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
