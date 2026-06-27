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

const SEVERITY_STYLE_MAP: Record<Finding['severity'], string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

export const SEVERITY_STYLE = SEVERITY_STYLE_MAP;

export function SeverityBadge({ severity }: { severity: Finding['severity'] }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_STYLE_MAP[severity])}>
      {severity}
    </span>
  );
}

/* ── Table row ──────────────────────────────────────────────────── */

function FindingTableRow({ finding, index, selected, applied, disabled, onSelect }: {
  finding: Finding;
  index: number;
  selected?: boolean;
  applied?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(finding.evidence || finding.suggestion);

  return (
    <>
      <tr
        className={cn(
          'border-b border-line/50 transition-colors',
          applied ? 'bg-sage-tint/20' : selected ? 'bg-accent-tint/30' : 'hover:bg-surface-2/40',
          onSelect && !disabled && 'cursor-pointer',
        )}
        onClick={() => !disabled && onSelect?.()}
      >
        {onSelect ? (
          <td className="w-10 py-3 pl-4 pr-1">
            <span className={cn(
              'grid size-5 place-items-center rounded-[5px] border text-[10px] font-semibold transition-colors',
              applied ? 'border-[var(--sage-deep)] bg-[var(--sage-deep)] text-white'
                : selected ? 'border-accent bg-accent text-white'
                : 'border-line-strong text-ink-faint',
            )}>
              {applied || selected ? <Check className="size-3" /> : (index + 1)}
            </span>
          </td>
        ) : null}
        <td className="w-20 py-3 px-2">
          <SeverityBadge severity={finding.severity} />
        </td>
        <td className="py-3 px-2">
          <p className="text-sm text-ink">{finding.claim}</p>
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{finding.category.replace(/-/g, ' ')}</span>
        </td>
        <td className="w-10 py-3 pr-4">
          {hasDetails ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="grid size-6 place-items-center rounded text-ink-faint hover:bg-surface-2 hover:text-ink"
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-line/30 bg-surface-2/20">
          <td colSpan={onSelect ? 4 : 3} className="px-4 py-3">
            <div className="space-y-1.5 pl-6">
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
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ── Exports ────────────────────────────────────────────────────── */

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
    <table className="w-full"><tbody>
      <FindingTableRow finding={finding} index={index ?? 0} selected={selected} applied={applied} disabled={disabled} onSelect={onSelect} />
    </tbody></table>
  );
}

export interface FindingsGridProps {
  findings: Finding[];
  selectable?: boolean;
  applying?: boolean;
  applied?: boolean;
  readOnly?: boolean;
  onApply?: (selectedIndices: number[]) => void;
  onSelectionChange?: (selectedIndices: number[]) => void;
  selectedIndices?: number[];
  appliedLabel?: string;
  hideApplyBar?: boolean;
}

export function FindingsGrid({ findings, selectable, applying, applied, readOnly, onApply, onSelectionChange, selectedIndices, appliedLabel, hideApplyBar }: FindingsGridProps) {
  const controlled = selectedIndices !== undefined;
  const [internal, setInternal] = useState<Set<number>>(new Set());
  const sel = controlled ? new Set(selectedIndices) : internal;
  const toggle = (i: number) => {
    const n = new Set(sel); if (n.has(i)) n.delete(i); else n.add(i);
    if (!controlled) setInternal(n);
    onSelectionChange?.([...n]);
  };

  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const disabled = readOnly || !!applying || !!applied;

  return (
    <div>
      {findings.length > 0 ? (
        <>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                {selectable ? <th className="w-10 py-2 pl-4 pr-1" /> : null}
                <th className="w-20 py-2 px-2">Severity</th>
                <th className="py-2 px-2">Finding</th>
                <th className="w-10 py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((f, i) => {
                const origIdx = findings.indexOf(f);
                return (
                  <FindingTableRow
                    key={i}
                    finding={f}
                    index={origIdx}
                    selected={sel.has(origIdx)}
                    applied={applied}
                    disabled={disabled}
                    onSelect={selectable ? () => toggle(origIdx) : undefined}
                  />
                );
              })}
            </tbody>
          </table>
          {selectable && onApply && !hideApplyBar ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
              {applied ? (
                <span className="text-xs font-medium text-[var(--sage-deep)]">{appliedLabel ?? 'Applied.'}</span>
              ) : (
                <>
                  {sel.size > 0 ? (
                    <span className="mr-auto flex items-center gap-2 text-xs text-ink-faint">
                      {sel.size} selected
                      <button type="button" onClick={() => { if (!controlled) setInternal(new Set()); onSelectionChange?.([]); }} className="text-accent hover:text-accent-deep">Clear</button>
                    </span>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => onApply(findings.map((_, i) => i))} disabled={disabled} loading={applying}>
                    Apply all
                  </Button>
                  {sel.size > 0 ? (
                    <Button size="sm" onClick={() => onApply([...sel])} disabled={disabled} loading={applying}>
                      Apply ({sel.size})
                    </Button>
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

/* ── Audit round card (right panel) ─────────────────────────────── */

export interface AuditRoundCardProps {
  passNo: number;
  verdict: 'clean' | 'revised';
  findings: Finding[];
  applied?: boolean;
  active?: boolean;
  onClick?: () => void;
}

export function AuditRoundCard({ passNo, verdict, findings, applied, active, onClick }: AuditRoundCardProps) {
  const counts = SEVERITY_ORDER.map((s) => ({ severity: s, count: findings.filter((f) => f.severity === s).length })).filter((c) => c.count > 0);
  return (
    <button type="button" onClick={onClick} className={cn(
      'w-full rounded-[var(--r-md)] border p-3 text-left transition-colors hover:bg-surface-2/50',
      active ? 'border-accent bg-accent-tint/20' : 'border-line bg-surface',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">Pass {passNo}</span>
          <Badge variant={verdict === 'clean' ? 'sage' : 'neutral'} size="sm">{verdict === 'clean' ? 'clean' : 'has findings'}</Badge>
          {applied ? <Badge variant="sage" size="sm">applied</Badge> : null}
        </div>
        <span className="text-xs text-ink-faint">{findings.length} findings</span>
      </div>
      {counts.length > 0 ? (
        <div className="mt-2 flex gap-1.5">
          {counts.map((c) => (
            <span key={c.severity} className={cn('inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold', SEVERITY_STYLE_MAP[c.severity])}>
              {c.count} {c.severity}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}
