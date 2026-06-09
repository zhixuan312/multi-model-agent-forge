import { edgeStyle } from '@/components/forge/journal/palette';
import { cn } from '@/lib/cn';

/**
 * A typed edge chip. Outgoing edges render `<type> → <target>`; inbound edges
 * render `← <inverse-label> <source>`. The target/source is a button so the
 * caller can navigate to that node. Colour is always paired with the label text
 * + an aria-label (not colour-only — a11y F17).
 */
export function EdgeChip({
  type,
  node,
  direction,
  onNavigate,
}: {
  /** forward type (outgoing) or inverse label (inbound). */
  type: string;
  node: string;
  direction: 'out' | 'in';
  onNavigate?: (id: string) => void;
}) {
  const s = edgeStyle(type);
  const arrow = direction === 'out' ? '→' : '←';
  const ariaLabel =
    direction === 'out' ? `${type} → node ${node}` : `${type} ← node ${node}`;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => onNavigate?.(node)}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px] font-medium hover:underline',
        s.cls,
      )}
    >
      {direction === 'in' ? (
        <>
          <span aria-hidden>{arrow}</span>
          <span>{type}</span>
          <span className="font-mono">{node}</span>
        </>
      ) : (
        <>
          <span>{type}</span>
          <span aria-hidden>{arrow}</span>
          <span className="font-mono">{node}</span>
        </>
      )}
    </button>
  );
}
