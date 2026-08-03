import { Fragment, type ReactNode } from 'react';
import { ProseBlock } from '@/components/patterns';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Eyebrow, Mono, TextSm } from '@/components/ui/typography';
import { READ_ROUTES, type RouteSubtype } from '@/content/direction-reference';
import { SEVERITY_ORDER } from '@/lib/severity';

/**
 * Severity → `Badge` variant. The ladder rides the design system's status tints rather
 * than a bespoke colour scale, and must read the same as the product's own findings
 * ladder (`SEVERITY_STYLE` in patterns/findings.tsx): rose · amber · frost-steel ·
 * neutral. `medium` was `neutral` here, so the manual drew medium and low identically
 * while the app distinguishes them — the reference describing severity disagreed with
 * the surface applying it.
 */
const SEVERITY_VARIANT: Record<string, BadgeProps['variant']> = {
  critical: 'rose',
  high: 'amber',
  medium: 'steel',
  low: 'neutral',
};

function SeverityRow({ tier, text }: { tier: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
      <Badge variant={SEVERITY_VARIANT[tier] ?? 'neutral'} size="sm" className="shrink-0 self-start uppercase sm:w-20">
        {tier}
      </Badge>
      <TextSm className="min-w-0 flex-1 !text-xs">{text}</TextSm>
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
    <div className="overflow-x-auto">
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
                    <TableCell colSpan={3} className="py-2">
                      <Eyebrow as="span">{header}</Eyebrow>
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell className="py-2 align-top">
                    <Mono className="!text-xs !text-ink-faint">{c.id}</Mono>
                  </TableCell>
                  <TableCell className="py-2 align-top">
                    <Mono className="!text-xs font-medium !text-ink">{c.title}</Mono>
                  </TableCell>
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

/** One labelled fact in the route summary card. */
function SummaryFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Eyebrow as="span">{label}</Eyebrow>
      {children}
    </div>
  );
}

/**
 * The exact criteria reference for one read-only route — its semantics
 * (finding meaning, must-emit, outcomes) in a summary card, then one card per
 * subtype carrying the criteria matrix and the severity ladder. Data is verbatim
 * from the criteria source.
 */
export function RouteBlock({ routeKey }: { routeKey: string }) {
  const r = READ_ROUTES.find((x) => x.route === routeKey);
  if (!r) return null;
  return (
    <section className="flex flex-col gap-4" aria-label={`${r.route} criteria`}>
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryFact label="Finding">
            <TextSm className="!text-xs !text-ink">{r.findingMeaning}</TextSm>
          </SummaryFact>
          <SummaryFact label="Must emit ≥1">
            <TextSm className="!text-xs !text-ink">{r.mustEmit ? 'Yes' : 'No'}</TextSm>
          </SummaryFact>
          <SummaryFact label="Outcomes">
            <Mono className="!text-xs">{r.outcomes}</Mono>
          </SummaryFact>
        </CardContent>
      </Card>

      {r.subtypes.map((st) => {
        const sev = st.severity ?? r.severity;
        return (
          <Card key={st.key}>
            <CardHeader>
              <CardTitle className="!text-sm">
                subtype: <Mono className="!text-sm !text-accent-deep">{st.key}</Mono>
              </CardTitle>
              <Badge variant="neutral" size="sm" className="shrink-0">
                {st.criteria.length} criteria
              </Badge>
            </CardHeader>
            <CardContent>
              <TextSm className="!text-xs">{st.blurb}</TextSm>
            </CardContent>
            <div className="border-t border-line">
              <CriteriaTable subtype={st} />
            </div>
            <div className="divide-y divide-line border-t border-line bg-surface-2/50">
              {/* Subtype OVERRIDE only — the route-level meaning is already in the summary
                  card above, so there is nothing to fall back to here. `?? r.findingMeaning`
                  used to sit on this value, unreachable behind this very guard. */}
              {st.findingMeaning && (
                <div className="flex flex-col gap-1.5 px-5 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <Eyebrow as="span" className="shrink-0 sm:w-20">
                    Finding
                  </Eyebrow>
                  <TextSm className="min-w-0 flex-1 !text-xs">{st.findingMeaning}</TextSm>
                </div>
              )}
              {/* Driven by SEVERITY_ORDER so the ladder cannot fall out of step with the
                  one the product sorts and styles by. */}
              {SEVERITY_ORDER.map((tier) => (
                <SeverityRow key={tier} tier={tier} text={sev[tier]} />
              ))}
            </div>
          </Card>
        );
      })}
    </section>
  );
}
