import { CHIP, statusStyle, opStyle } from '@/components/forge/journal/palette';
import { cn } from '@/lib/cn';

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
