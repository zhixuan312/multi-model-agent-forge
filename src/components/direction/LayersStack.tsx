import { Fragment } from 'react';
import { cn } from '@/lib/cn';
import { ProseBlock } from '@/components/patterns';
import { AGENT_LAYERS } from '@/content/direction-reference';

/**
 * The three agent layers as a top-to-bottom stack: the main agent (yours,
 * keeps judgment) on top, then the two configurable labor slots — complex and
 * standard. Each layer states its responsibility.
 */
export function LayersStack() {
  return (
    <div className="flex flex-col gap-2">
      {AGENT_LAYERS.map((l, i) => (
        <Fragment key={l.name}>
          <div
            className={cn(
              'flex flex-col gap-2 rounded-[var(--r-md)] border p-4',
              l.kind === 'main' ? 'border-accent bg-accent-tint/25' : 'border-line bg-surface',
            )}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-ink">{l.name}</span>
              <ProseBlock variant="compact" className="text-ink-faint">
                {l.tag}
              </ProseBlock>
            </div>
            <ProseBlock variant="compact">{l.role}</ProseBlock>
            <div className="text-[0.6875rem] text-ink-faint">{l.examples}</div>
          </div>
          {i === 0 && (
            <div className="text-center text-xs text-ink-faint" aria-hidden="true">
              ↓ delegates labor to the two slots you configure
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
