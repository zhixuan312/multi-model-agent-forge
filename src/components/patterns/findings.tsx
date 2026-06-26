'use client';

import { useState } from 'react';
import { Check, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';
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

export const SEVERITY_STYLE: Record<Finding['severity'], string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  return (
    <span className={cn('inline-flex w-[58px] shrink-0 items-center justify-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_STYLE[severity])}>
      {severity}
    </span>
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

export function FindingCard({ finding, index, selected, applied, disabled, onSelect }: FindingCardProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect?.()}
      disabled={disabled}
      className={cn(
        'flex flex-col gap-1.5 p-3 text-left transition-colors',
        applied ? 'bg-sage-tint/30' : selected ? 'bg-accent-tint/40' : 'bg-surface hover:bg-surface-2/50',
        disabled && !applied && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1.5">
        {index != null ? (
          <span className={cn('grid size-5 shrink-0 place-items-center rounded-[6px] border text-[10px] font-semibold transition-colors', applied ? 'border-[var(--sage-deep)] bg-[var(--sage-deep)] text-white' : selected ? 'border-accent bg-accent text-white' : 'border-line-strong text-ink-faint')}>
            {applied || selected ? <Check className="size-3" /> : (index + 1)}
          </span>
        ) : null}
        <SeverityBadge severity={finding.severity} />
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{finding.category.replace(/-/g, ' ')}</span>
      <p className="text-xs leading-relaxed text-ink">{finding.claim}</p>
      {finding.evidence ? <p className="text-[10px] leading-relaxed text-ink-soft"><span className="font-semibold">Evidence:</span> {finding.evidence}</p> : null}
      {finding.suggestion ? <p className="text-[10px] leading-relaxed text-accent-deep"><span className="font-semibold">Fix:</span> {finding.suggestion}</p> : null}
    </button>
  );
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
    <div className="overflow-hidden rounded-2xl rounded-tl-md border border-line bg-surface shadow-sm">
      {findings.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-px bg-line/70">
            {sorted.map((f, i) => {
              const origIdx = findings.indexOf(f);
              return (
                <FindingCard
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
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-3.5 py-2.5">
              {applied ? (
                <div className="flex items-center gap-2">
                  <Check className="size-3.5 text-[var(--sage-deep)]" />
                  <span className="text-xs font-medium text-[var(--sage-deep)]">{appliedLabel ?? 'All findings applied.'}</span>
                </div>
              ) : applying ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-accent-deep">Applying...</span>
                </div>
              ) : (
                <>
                  <span className="text-[11px] text-ink-faint">Select findings to apply, or apply all at once.</span>
                  <span className="flex-1" />
                  <Button size="sm" variant="secondary" onClick={() => onApply([...sel])} disabled={readOnly || sel.size === 0} leftIcon={<Check />}>
                    Apply selected{sel.size > 0 ? ` (${sel.size})` : ''}
                  </Button>
                  <Button size="sm" onClick={() => onApply(findings.map((_, i) => i))} disabled={readOnly} leftIcon={<Sparkles />}>
                    Apply all {findings.length}
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </>
      ) : null}
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
  const counts: Record<Finding['severity'], number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full rounded-[var(--r-md)] border p-3 text-left transition-colors',
        applied ? 'border-[var(--sage-deep)]/30 bg-sage-tint/30' : 'border-line bg-surface hover:border-accent hover:bg-surface-2/40',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">Pass {passNo}</span>
        <Badge variant={verdict === 'clean' ? 'sage' : 'neutral'} size="sm">{verdict}</Badge>
        {applied ? <Badge variant="sage" size="sm">applied</Badge> : null}
        <span className="ml-auto text-[11px] text-ink-faint">{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
      </div>
      {findings.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <span key={s} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', SEVERITY_STYLE[s])}>
              <span className="font-semibold">{counts[s]}</span>{s}
            </span>
          ))}
        </div>
      ) : null}
      {onClick ? (
        <span className="mt-2 flex items-center gap-1 text-[11px] font-medium text-ink-faint group-hover:text-accent">
          <ArrowRight className="size-3" /> Re-post to chat
        </span>
      ) : null}
    </button>
  );
}

export function FindingsClean({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <CheckCircle2 className="size-8 text-[var(--sage)]" />
      <p className="text-sm font-medium text-[var(--sage-deep)]">{message ?? 'Clean — no findings.'}</p>
    </div>
  );
}
