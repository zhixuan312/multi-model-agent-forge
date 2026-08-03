import { statusStyle, opStyle } from '@/components/forge/journal/palette';
import { cn } from '@/lib/cn';

/** The journal chip shape. Shared so the status chip and the write-log op chip cannot
 *  drift apart — they carried the same six utilities written out twice. */
const CHIP = 'inline-flex items-center rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium';

/** A status chip carrying both colour and the status text label (a11y F17). */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = statusStyle(status);
  return <span className={cn(CHIP, s.cls, className)}>{s.label}</span>;
}

/** A write-log op chip — same shape as the status chip, op-coloured, always with the
 *  op text (an op outside the known set gets the neutral tint, never nothing). */
export function OpBadge({ op, className }: { op: string; className?: string }) {
  return <span className={cn(CHIP, opStyle(op).cls, className)}>{op}</span>;
}

/** A small status DOT that conveys status non-visually via an aria-label.
 *  `role="img"`, not `role="status"`: `status` is a LIVE REGION, and Recall renders one
 *  dot per result row, so a search turned every row into its own polite announcer. This
 *  is a graphic that carries meaning — exactly what `img` + a label is for. */
export function StatusDot({ status }: { status: string }) {
  const s = statusStyle(status);
  return (
    <span
      role="img"
      aria-label={`status: ${s.label}`}
      title={s.label}
      className={cn('inline-block size-2 rounded-full', s.dot)}
    />
  );
}
