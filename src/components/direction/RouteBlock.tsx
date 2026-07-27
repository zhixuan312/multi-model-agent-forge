import { Fragment } from 'react';
import { cn } from '@/lib/cn';
import { ProseBlock } from '@/components/patterns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { READ_ROUTES, type RouteSubtype } from '@/content/direction-reference';

const SEVERITY_TONE: Record<string, string> = {
  critical: 'text-[var(--danger)]',
  high: 'text-accent-deep',
  medium: 'text-ink',
  low: 'text-ink-faint',
};

function SeverityRow({ tier, text }: { tier: string; text: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-line/70 py-1.5 last:border-0">
      <span className={cn('w-16 shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wide', SEVERITY_TONE[tier])}>
        {tier}
      </span>
      <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">{text}</span>
    </div>
  );
}

/** The criteria table for one subtype. Grouped subtypes (audit `plan`) get a
 *  spanning group row above each cluster, exactly as the criteria source orders them. */
/** Pure pass over the criteria: the group label to print ABOVE row `i`, or
 *  `undefined` when row `i` continues the previous cluster. Computed outside the
 *  render tree so no state is carried across the row map. */
function groupHeaders(criteria: RouteSubtype['criteria']): (string | undefined)[] {
  const grouped = criteria.some((c) => c.group);
  if (!grouped) return criteria.map(() => undefined);
  const headers: (string | undefined)[] = [];
  let lastGroup = '';
  for (const c of criteria) {
    headers.push(c.group && c.group !== lastGroup ? c.group : undefined);
    if (c.group) lastGroup = c.group;
  }
  return headers;
}

function CriteriaTable({ subtype }: { subtype: RouteSubtype }) {
  const headers = groupHeaders(subtype.criteria);
  return (
    <div className="overflow-x-auto rounded-[var(--r-md)] border border-line">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Criterion</TableHead>
            <TableHead>What it checks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subtype.criteria.map((c, i) => {
            const header = headers[i];
            return (
              <Fragment key={c.id}>
                {header && (
                  <TableRow className="bg-surface-2">
                    <TableCell
                      colSpan={3}
                      className="py-2 text-[0.625rem] font-semibold uppercase tracking-wide text-ink-faint"
                    >
                      {header}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell className="py-2 align-top text-xs text-ink-faint">{c.id}</TableCell>
                  <TableCell className="py-2 align-top text-xs font-semibold text-ink">{c.title}</TableCell>
                  <TableCell className="py-2 align-top">
                    <ProseBlock variant="compact">{c.desc}</ProseBlock>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The exact criteria reference for one read-only route — its semantics
 * (finding meaning, must-emit, outcomes), severity ladder, and per-subtype
 * criteria tables. Data is verbatim from the criteria source.
 */
export function RouteBlock({ routeKey }: { routeKey: string }) {
  const r = READ_ROUTES.find((x) => x.route === routeKey);
  if (!r) return null;
  return (
    <section className="flex flex-col gap-4" aria-label={`${r.route} criteria`}>
      <dl className="grid grid-cols-1 gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-ink-faint">Finding</dt>
          <dd className="text-xs leading-relaxed text-ink">{r.findingMeaning}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-ink-faint">Must emit ≥1</dt>
          <dd className="text-xs leading-relaxed text-ink">{r.mustEmit ? 'Yes' : 'No'}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-ink-faint">Outcomes</dt>
          <dd className="text-xs leading-relaxed text-ink">
            <code>{r.outcomes}</code>
          </dd>
        </div>
      </dl>

      {r.subtypes.map((st) => {
        const sev = st.severity ?? r.severity;
        const finding = st.findingMeaning ?? r.findingMeaning;
        return (
          <div key={st.key} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-accent-deep">subtype: {st.key}</span>
              <span className="text-[0.6875rem] text-ink-faint">{st.criteria.length} criteria</span>
            </div>
            <p className="text-xs leading-relaxed text-ink-soft">{st.blurb}</p>
            <CriteriaTable subtype={st} />
            <div className="rounded-[var(--r-md)] border border-line bg-surface px-4 py-2">
              {st.findingMeaning && (
                <p className="border-b border-line/70 py-1.5 text-xs leading-relaxed text-ink-soft">
                  Finding: {finding}
                </p>
              )}
              <SeverityRow tier="critical" text={sev.critical} />
              <SeverityRow tier="high" text={sev.high} />
              <SeverityRow tier="medium" text={sev.medium} />
              <SeverityRow tier="low" text={sev.low} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
