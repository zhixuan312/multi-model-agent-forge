import { Fragment } from 'react';
import { ProseBlock } from '@/components/patterns';
import { LIFECYCLE_STAGES } from '@/content/direction-reference';

/**
 * The AI development lifecycle the harness gates — the same stages `/mma-flow`
 * runs, as a top-to-bottom flow: design → spec → spec-audit → plan → plan-audit
 * → execute → review → verify → ship → record. A failed Verify loops back
 * through debug/retry to Plan/Execute, and the journal bookends it (recall at
 * design, record at the close) so each cycle feeds the next. Each stage shows
 * the rods that gate it, plus what it does and why it's there.
 */
export function LifecycleFlow() {
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-1">
        {LIFECYCLE_STAGES.map((s, i) => (
          <Fragment key={s.stage}>
            <li className="flex flex-col gap-2 rounded-[var(--r-md)] border border-line bg-surface p-3 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="w-28 shrink-0 text-sm font-semibold text-accent-deep">{s.stage}</span>
              <div className="min-w-0 flex-1 space-y-1">
                {s.desc.map((d, j) => (
                  <ProseBlock variant="compact" key={j}>
                    {d}
                  </ProseBlock>
                ))}
              </div>
            </li>
            {i < LIFECYCLE_STAGES.length - 1 && (
              <li className="text-center text-xs text-ink-faint" aria-hidden="true">
                ↓
              </li>
            )}
          </Fragment>
        ))}
      </ol>
      <p className="rounded-[var(--r-md)] border border-accent-tint bg-accent-tint/40 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        ↻ A failed <strong className="font-semibold text-ink">Verify</strong> sends <code>debug</code> + <code>retry</code> back to Plan / Execute — a failure becomes a fix, not a dead end. We harness the lifecycle; we don&apos;t author it — the engineer still calls what to build and what to merge.
      </p>
    </div>
  );
}
