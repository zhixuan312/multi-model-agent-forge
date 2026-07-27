import { ProseBlock } from '@/components/patterns';
import { PRINCIPLES } from '@/content/direction-reference';

/**
 * The six global principles as a full-width responsive grid of numbered cards —
 * verbatim and in order from DIRECTION.md § Global Principles. Scannable at a
 * glance; the body text is the real principle, not a paraphrase.
 */
export function PrinciplesGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {PRINCIPLES.map((p) => (
        <article
          key={p.n}
          className="flex flex-col gap-2 rounded-[var(--r-md)] border border-line bg-surface p-4"
        >
          <div className="text-[0.6875rem] font-semibold tracking-wide text-accent">
            {String(p.n).padStart(2, '0')}
          </div>
          <h3 className="text-sm font-semibold leading-snug text-ink">{p.title}</h3>
          <ProseBlock variant="compact">{p.text}</ProseBlock>
        </article>
      ))}
    </div>
  );
}
