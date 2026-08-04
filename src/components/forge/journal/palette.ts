/**
 * Code-defined palette for the journal's fixed enums (Spec 6 §UI/routes). All
 * four statuses and every edge type are bound; an unknown value falls back to a
 * NEUTRAL grey chip (never throws). Status/edge chips always pair colour with a
 * text label (never colour-only — a11y F17).
 */
import { isStatus, LOG_OPS, type LogOp } from '@/journal/types';

/**
 * The journal chip shape — status chip, write-log op chip and the recall marker all
 * use it. It was spelled out in each of the three files.
 */
export const CHIP =
  'inline-flex items-center rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium';

/** status → semantic token (background-tint + text class). */
const STATUS_TOKEN: Record<string, { label: string; cls: string; dot: string }> = {
  adopted: { label: 'adopted', cls: 'bg-sage-tint text-sage-deep border-sage', dot: 'bg-sage' },
  superseded: { label: 'superseded', cls: 'bg-amber-tint text-amber border-amber', dot: 'bg-amber' },
  inconclusive: { label: 'inconclusive', cls: 'bg-surface-2 text-steel-deep border-steel', dot: 'bg-steel' },
  dropped: { label: 'dropped', cls: 'bg-rose-tint text-rose border-rose', dot: 'bg-rose' },
};

const NEUTRAL = {
  cls: 'bg-surface-2 text-ink-soft border-line',
  dot: 'bg-ink-faint',
};

export interface StatusStyle {
  label: string;
  cls: string;
  dot: string;
}

/** Resolve a status value to its chip style (neutral for unknown). */
export function statusStyle(status: string): StatusStyle {
  if (isStatus(status)) return { ...STATUS_TOKEN[status]! };
  return { label: status || 'unknown', cls: NEUTRAL.cls, dot: NEUTRAL.dot };
}

/**
 * op → colour class. TOTAL over `LOG_OPS`, so the vocabulary has one definition.
 *
 * This was a `switch` spelling the four ops out as string literals — a second copy of
 * `LOG_OPS`, which left the constant with no production consumer at all and its cross-repo
 * drift guard (`journal/contract.test.ts`, comparing it to a checked-in fixture of MMA's
 * enums) unable to affect anything Forge does. Keyed on the type instead, an op MMA adds
 * fails the build here rather than silently rendering grey forever.
 */
const OP_TOKEN: Record<LogOp, string> = {
  create: 'bg-sage-tint text-sage-deep border-sage',
  refine: 'bg-ember-tint text-ember-deep border-ember',
  supersede: 'bg-amber-tint text-amber border-amber',
  merge: 'bg-surface-2 text-steel-deep border-steel',
};

const isLogOp = (v: string): v is LogOp => (LOG_OPS as readonly string[]).includes(v);

/** Resolve a write-log op to its chip colour (neutral grey for unknown, never throws).
 *  Always paired with the op text — never colour-only (a11y F17).
 *  Both resolvers used to also return a `known: boolean` that no caller ever read. */
export function opStyle(op: string): { cls: string } {
  return { cls: isLogOp(op) ? OP_TOKEN[op] : NEUTRAL.cls };
}

