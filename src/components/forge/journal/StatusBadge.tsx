import { statusStyle } from '@/components/forge/journal/palette';
import { cn } from '@/lib/cn';

/** A status chip carrying both colour and the status text label (a11y F17). */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = statusStyle(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium',
        s.cls,
        className,
      )}
    >
      {s.label}
    </span>
  );
}

/** A small status DOT that conveys status non-visually via an aria-label. */
export function StatusDot({ status }: { status: string }) {
  const s = statusStyle(status);
  return (
    <span
      role="status"
      aria-label={`status: ${s.label}`}
      title={s.label}
      className={cn('inline-block size-2 rounded-full', s.dot)}
    />
  );
}
