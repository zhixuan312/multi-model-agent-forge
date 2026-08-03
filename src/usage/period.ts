/**
 * The usage reporting period — one definition for the pages, the query core and the
 * picker.
 *
 * The accepted set was written out FIVE times: as the `Period` union in `usage-core`, as
 * a `['week','month',…].includes(...)` whitelist in each of the four usage pages (every
 * one followed by an unchecked `as Period`), and as the option list inside
 * `PeriodSelect`. Adding a period meant editing six places, and missing one of the four
 * pages would silently reject the new value and fall back to the default — a bug with no
 * error anywhere.
 *
 * DB-free so the `'use client'` picker can import it.
 */
export const PERIODS = ['week', 'month', '30d', '90d', 'all'] as const;

export type Period = (typeof PERIODS)[number];

/** What a page shows when the URL names no period, or names one that is not valid. */
export const DEFAULT_PERIOD: Period = 'month';

/** Human label for each period, shown in the picker. */
export const PERIOD_LABEL: Record<Period, string> = {
  week: 'This week',
  month: 'This month',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
};

/**
 * Narrow an untrusted `?period=` to a real one. Returns `DEFAULT_PERIOD` for anything
 * unrecognised — the pages previously did this with a cast, which types could not check.
 */
export function parsePeriod(raw: string | null | undefined): Period {
  return (PERIODS as readonly string[]).includes(raw ?? '') ? (raw as Period) : DEFAULT_PERIOD;
}
