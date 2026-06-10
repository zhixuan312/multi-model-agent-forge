import { Anvil } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * ForgeMark — the product brand lockup. An ember tile (accent gradient + inset
 * highlight + soft pop shadow) carrying a white anvil glyph from the same Lucide
 * family the rest of the app uses, optionally paired with the serif wordmark.
 *
 * Replaces the old `⚒` emoji-in-a-box: a real, themeable, crisp-at-any-size mark
 * instead of a font-dependent glyph. Use `withWordmark` in the sidebar/login
 * brand zone; the bare tile works as a compact favicon-style mark.
 */
export function ForgeMark({
  withWordmark = false,
  className,
}: {
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'grid size-7 place-items-center rounded-[9px] text-white',
          'bg-[linear-gradient(150deg,var(--accent),var(--accent-deep))]',
          'shadow-[var(--shadow-pop)] ring-1 ring-inset ring-white/20',
        )}
      >
        <Anvil className="size-[17px]" strokeWidth={2.25} />
      </span>
      {withWordmark ? (
        <span className="font-serif text-lg font-semibold tracking-tight text-ink">Forge</span>
      ) : null}
    </span>
  );
}
