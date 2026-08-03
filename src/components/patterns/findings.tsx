'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button } from '@/components/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SEVERITY_ORDER, compareSeverity, type Severity } from '@/lib/severity';

export interface Finding {
  /** `lib/severity`'s type, not a second spelling of its four values. */
  severity: Severity;
  category: string;
  claim: string;
  evidence?: string;
  suggestion?: string;
}

/**
 * The findings chip's tint per severity. TOTAL over `Severity`, so a new tier fails the
 * build here rather than rendering an unstyled chip.
 *
 * This module also re-exported `SEVERITY_ORDER` (a spread copy of `lib/severity`'s) and
 * aliased this map to a second name in the same file. Every other consumer already imports
 * the order from `lib/severity`; a second importable name for one list is how the two
 * eventually disagree.
 */
export const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

/**
 * Tint for a severity, tolerating one outside the set.
 *
 * `severity` is typed, but it originates as a free-text `weight` on the engine envelope and
 * reaches here through an unchecked cast, so an unexpected word is a real input. Indexing
 * the map directly returned `undefined` for it and rendered a chip with padding and text
 * but no background — the same silent breakage the journal category chips had.
 */
function severityStyle(severity: string): string {
  return SEVERITY_STYLE[severity as Severity] ?? SEVERITY_STYLE.low;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', severityStyle(severity))}>
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
      <TableRow
        className={cn(
          'border-b border-line/50 transition-colors',
          applied ? 'bg-sage-tint/20' : selected ? 'bg-accent-tint/30' : 'hover:bg-surface-2/40',
          onSelect && !disabled && 'cursor-pointer',
        )}
        onClick={() => !disabled && onSelect?.()}
      >
        {onSelect ? (
          <TableCell className="w-10 px-0 py-3 pl-4 pr-1">
            {/* A real checkbox, not a decorated <span>. Picking a subset of findings to
                apply was pointer-only: the box carried no role, no checked state and no
                name, and the only handler was `onClick` on the <tr> — which is not
                focusable and answers no key. A screen reader heard a row of text with no
                indication that any of it was selectable, let alone what was selected.
                `stopPropagation` so the row's own click doesn't toggle it straight back. */}
            <button
              type="button"
              role="checkbox"
              aria-checked={applied ? true : Boolean(selected)}
              aria-label={`Select: ${finding.claim}`}
              disabled={disabled}
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className={cn(
                'focus-ring grid size-5 place-items-center rounded-[5px] border text-[10px] font-semibold transition-colors',
                applied ? 'border-[var(--sage-deep)] bg-[var(--sage-deep)] text-white'
                  : selected ? 'border-accent bg-accent text-white'
                  : 'border-line-strong text-ink-faint',
                disabled && 'cursor-not-allowed',
              )}
            >
              {applied || selected ? <Check className="size-3" /> : (index + 1)}
            </button>
          </TableCell>
        ) : null}
        <TableCell className="w-20 px-2 py-3">
          <SeverityBadge severity={finding.severity} />
        </TableCell>
        <TableCell className="px-2 py-3">
          <p className="text-sm text-ink">{finding.claim}</p>
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{finding.category.replace(/-/g, ' ')}</span>
        </TableCell>
        <TableCell className="w-10 px-0 py-3 pr-4">
          {hasDetails ? (
            // Icon-only, so it needs BOTH a name and a state: without them a screen reader
            // announces an unlabelled "button" and never says whether the finding's
            // evidence is currently showing.
            <button
              type="button"
              aria-label={expanded ? 'Hide finding details' : 'Show finding details'}
              aria-expanded={expanded}
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="grid size-6 place-items-center rounded text-ink-faint hover:bg-surface-2 hover:text-ink"
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : null}
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="border-b border-line/30 bg-surface-2/20">
          <TableCell colSpan={onSelect ? 4 : 3} className="px-4 py-3">
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
          </TableCell>
        </TableRow>
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
    <Table><TableBody>
      <FindingTableRow finding={finding} index={index ?? 0} selected={selected} applied={applied} disabled={disabled} onSelect={onSelect} />
    </TableBody></Table>
  );
}

/**
 * How much of a pass has been applied.
 *
 * Applying a SUBSET must leave the remainder actionable — `allApplied` is what locks a pass,
 * not `someApplied`. The Review stage had this logic; the Plan stage computed its
 * `appliedIndices` and then dropped them on the floor, so a partial apply there marked no
 * rows and locked the whole pass. One definition, so the two cannot disagree again.
 */
export function appliedState(findingsCount: number, appliedIndices: readonly number[]): {
  someApplied: boolean;
  allApplied: boolean;
  remainingIndices: number[];
} {
  const applied = new Set(appliedIndices);
  return {
    someApplied: appliedIndices.length > 0,
    allApplied: findingsCount > 0 && appliedIndices.length >= findingsCount,
    remainingIndices: Array.from({ length: findingsCount }, (_, i) => i).filter((i) => !applied.has(i)),
  };
}

export interface FindingsGridProps {
  findings: Finding[];
  /** Render a leading checkbox column so the user can pick a subset. Selection is
   * controlled by the caller (`selectedIndices` + `onToggle`) — pair with the shared
   * `FindingsApplyBar` in the card footer. Omit for a read-only table (unchanged look). */
  selectable?: boolean;
  selectedIndices?: number[];
  onToggle?: (index: number) => void;
  applying?: boolean;
  /** Whole-round applied — marks every finding applied. */
  applied?: boolean;
  /** Applied a SUBSET — only these finding indices show as applied (the checked ones stay
   *  checked/green); the rest stay normal. Takes precedence over `applied`. */
  appliedIndices?: number[];
  readOnly?: boolean;
}

/**
 * Severity-sorted findings table. Read-only by default; when `selectable`, adds a
 * checkbox column (indices are positions in the ORIGINAL `findings` array, which the
 * server re-parses in the same order, so a checked row maps 1:1 to the fixed finding).
 * The apply controls live in the shared `FindingsApplyBar` so all three audit/review
 * stages stay identical.
 */
export function FindingsGrid({ findings, selectable, selectedIndices, onToggle, applying, applied, appliedIndices, readOnly }: FindingsGridProps) {
  const sel = new Set(selectedIndices ?? []);
  const appliedSet = appliedIndices ? new Set(appliedIndices) : null;
  // `compareSeverity`, not a raw indexOf: an unrecognised severity gives -1 there, which
  // sorts it ABOVE critical. `lib/severity` documents precisely this — an unknown severity
  // is not evidence of urgency — and this, its only sorting consumer, was not using it.
  const sorted = [...findings].sort((a, b) => compareSeverity(a.severity, b.severity));
  const disabled = readOnly || !!applying || !!applied;

  return (
    <div>
      {findings.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              {selectable ? <TableHead className="w-10 px-0 py-2 pl-4 pr-1" /> : null}
              <TableHead className="w-20 px-2 py-2 font-sans text-[11px] tracking-wide">Severity</TableHead>
              <TableHead className="px-2 py-2 font-sans text-[11px] tracking-wide">Finding</TableHead>
              <TableHead className="w-10 px-0 py-2 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((f) => {
              const origIdx = findings.indexOf(f);
              return (
                <FindingTableRow
                  // The finding's own index, NOT its position in the sorted copy. Each row
                  // owns its expanded state, so keying by position moves that state to
                  // whichever finding lands there when the list re-sorts.
                  key={origIdx}
                  finding={f}
                  index={origIdx}
                  selected={selectable ? sel.has(origIdx) : undefined}
                  applied={appliedSet ? appliedSet.has(origIdx) : applied}
                  disabled={disabled}
                  onSelect={selectable ? () => onToggle?.(origIdx) : undefined}
                />
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-ink-faint">No findings.</p>
      )}
    </div>
  );
}

/**
 * The ONE apply-bar for every audit/review stage — rendered in the card footer, in
 * the exact spot the single Apply button used to sit. Shared so spec · plan · review
 * can't drift. Selection is owned by the caller; this renders Select-all + Apply and
 * reports intent back via `onToggleAll` / `onApply`.
 */
export function FindingsApplyBar({ selectedCount, total, applying, readOnly, onToggleAll, onApply }: {
  selectedCount: number;
  total: number;
  applying?: boolean;
  readOnly?: boolean;
  onToggleAll: () => void;
  onApply: () => void;
}) {
  const allSelected = total > 0 && selectedCount === total;
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
      <Button size="sm" variant="secondary" onClick={onToggleAll} disabled={readOnly || applying}>
        {allSelected ? 'Unselect all' : 'Select all'}
      </Button>
      {/* The count, or nothing — never the word "all". With an empty selection the button is
          disabled, so labelling it "Apply (all)" promised an action it refused: the label
          described a behaviour from before Select-all became the way to apply everything. */}
      <Button size="sm" onClick={onApply} disabled={readOnly || applying || selectedCount === 0} loading={applying}>
        {selectedCount > 0 ? `Apply (${selectedCount})` : 'Apply'}
      </Button>
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
      'flex w-full items-center gap-3 rounded-[var(--r-md)] border p-3 text-left transition-colors hover:bg-surface-2/50',
      active ? 'border-accent bg-accent-tint/20' : 'border-line bg-surface',
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">Pass {passNo}</span>
          {verdict === 'clean' ? <Badge variant="sage" size="sm">clean</Badge> : null}
          {applied ? <Badge variant="sage" size="sm">applied</Badge> : null}
        </div>
        {counts.length > 0 ? (
          <div className="mt-1.5 flex gap-1.5">
            {counts.map((c) => (
              <span key={c.severity} className={cn('inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold', severityStyle(c.severity))}>
                {c.count} {c.severity}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <span className="shrink-0 text-xs text-ink-faint">
        {findings.length} finding{findings.length !== 1 ? 's' : ''}
      </span>
    </button>
  );
}
