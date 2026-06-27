'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button } from '@/components/ui';

export interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  claim: string;
  evidence?: string;
  suggestion?: string;
}

export const SEVERITY_ORDER: Finding['severity'][] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_BORDER: Record<Finding['severity'], string> = {
  critical: 'border-l-[var(--rose)]',
  high: 'border-l-[var(--amber)]',
  medium: 'border-l-[var(--steel)]',
  low: 'border-l-line-strong',
};

const SEVERITY_BG: Record<Finding['severity'], string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

export const SEVERITY_STYLE = SEVERITY_BG;

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_BG[severity])}>
      {severity}
    </span>
  );
}

function FindingRow({ finding, index, selected, applied, disabled, onSelect }: {
  finding: Finding;
  index?: number;
  selected?: boolean;
  applied?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(finding.evidence || finding.suggestion);

  return (
    <div
      className={cn(
        'border-l-3 px-4 py-3 transition-colors',
        SEVERITY_BORDER[finding.severity],
        applied ? 'bg-sage-tint/20' : selected ? 'bg-accent-tint/30' : 'bg-surface hover:bg-surface-2/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        {index != null && onSelect ? (
          <button
            type="button"
            onClick={() => !disabled && onSelect()}
            disabled={disabled}
            className={cn(
              'mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] border text-[10px] font-semibold transition-colors',
              applied ? 'border-[var(--sage-deep)] bg-[var(--sage-deep)] text-white'
                : selected ? 'border-accent bg-accent text-white'
                : 'border-line-strong text-ink-faint hover:border-accent',
            )}
          >
            {applied || selected ? <Check className="size-3" /> : (index + 1)}
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              {finding.category.replace(/-/g, ' ')}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{finding.claim}</p>

          {hasDetails ? (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint hover:text-ink"
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          ) : null}

          {expanded ? (
            <div className="mt-2 space-y-1.5 border-t border-line/50 pt-2">
              {finding.evidence ? (
                <p className="text-xs leading-relaxed text-ink-soft">
                  <span className="font-semibold text-ink-faint">Evidence:</span> {finding.evidence}
                </p>
              ) : null}
              {finding.suggestion ? (
                <p className="text-xs leading-relaxed text-accent-deep">
                  <span className="font-semibold">Suggestion:</span> {finding.suggestion}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export interface FindingCardProps {
  finding: Finding;
  index?: number;
  selected?: boolean;
  applied?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export function FindingCard(props: FindingCardProps) {
  return <FindingRow {...props} />;
}

export interface FindingsGridProps {
  findings: Finding[];
  selectable?: boolean;
  applying?: boolean;
  applied?: boolean;
  readOnly?: boolean;
  onApply?: (selectedIndices: number[]) => void;
  appliedLabel?: string;
}

export function FindingsGrid({ findings, selectable, applying, applied, readOnly, onApply, appliedLabel }: FindingsGridProps) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const disabled = readOnly || !!applying || !!applied;

  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-line bg-surface shadow-sm">
      {findings.length > 0 ? (
        <>
          <div className="divide-y divide-line/50">
            {sorted.map((f, i) => {
              const origIdx = findings.indexOf(f);
              return (
                <FindingRow
                  key={i}
                  finding={f}
                  index={selectable ? origIdx : undefined}
                  selected={sel.has(origIdx)}
                  applied={applied}
                  disabled={disabled}
                  onSelect={() => toggle(origIdx)}
                />
              );
            })}
          </div>
          {selectable && onApply ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-4 py-2.5">
              {applied ? (
                <span className="text-xs font-medium text-[var(--sage-deep)]">{appliedLabel ?? 'Applied.'}</span>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={() => onApply([...sel])}
                    disabled={disabled || sel.size === 0}
                    loading={applying}
                  >
                    Apply {sel.size > 0 ? `${sel.size} selected` : ''}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onApply(findings.map((_, i) => i))}
                    disabled={disabled}
                    loading={applying}
                  >
                    Apply all
                  </Button>
                  {sel.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => setSel(new Set())}
                      className="text-xs text-ink-faint hover:text-ink"
                    >
                      Clear
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-ink-faint">No findings.</p>
      )}
    </div>
  );
}

export interface AuditRoundCardProps {
  passNo: number;
  verdict: 'clean' | 'revised';
  findings: Finding[];
  applied?: boolean;
  onClick?: () => void;
}

export function AuditRoundCard({ passNo, verdict, findings, applied, onClick }: AuditRoundCardProps) {
  const counts = SEVERITY_ORDER.map((s) => ({ severity: s, count: findings.filter((f) => f.severity === s).length })).filter((c) => c.count > 0);
  return (
    <button type="button" onClick={onClick} className="w-full rounded-[var(--r-md)] border border-line bg-surface p-3 text-left transition-colors hover:bg-surface-2/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">Pass {passNo}</span>
          <Badge variant={verdict === 'clean' ? 'sage' : 'neutral'} size="sm">{verdict}</Badge>
          {applied ? <Badge variant="sage" size="sm">applied</Badge> : null}
        </div>
        <span className="text-xs text-ink-faint">{findings.length} findings</span>
      </div>
      {counts.length > 0 ? (
        <div className="mt-2 flex gap-1.5">
          {counts.map((c) => (
            <SeverityBadge key={c.severity} severity={c.severity} />
          ))}
        </div>
      ) : null}
    </button>
  );
}
