/**
 * Code-defined palette for the journal's fixed enums (Spec 6 §UI/routes). All
 * four statuses and every edge type are bound; an unknown value falls back to a
 * NEUTRAL grey chip (never throws). Status/edge chips always pair colour with a
 * text label (never colour-only — a11y F17).
 */
import { isStatus } from '@/journal/types';

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

/** Write-log op → colour class (create=sage, refine=ember, supersede=amber,
 *  merge=steel; unknown=neutral grey). Always paired with the op text.
 *  Both resolvers used to also return a `known: boolean` that no caller ever read. */
export function opStyle(op: string): { cls: string } {
  switch (op) {
    case 'create':
      return { cls: 'bg-sage-tint text-sage-deep border-sage' };
    case 'refine':
      return { cls: 'bg-ember-tint text-ember-deep border-ember' };
    case 'supersede':
      return { cls: 'bg-amber-tint text-amber border-amber' };
    case 'merge':
      return { cls: 'bg-surface-2 text-steel-deep border-steel' };
    default:
      return { cls: NEUTRAL.cls };
  }
}
