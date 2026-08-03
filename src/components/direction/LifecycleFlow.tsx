import { RefreshCw } from 'lucide-react';
import { RailNote } from '@/components/patterns/feature-rail';
import { ProseBlock } from '@/components/patterns/prose-block';
import { Card } from '@/components/ui/card';
import { Eyebrow, Heading } from '@/components/ui/typography';
import { LIFECYCLE_STAGES } from '@/content/direction-reference';

/**
 * The AI development lifecycle the harness gates — the same stages `/mma-flow`
 * runs, in order: design → spec → spec-audit → plan → plan-audit → execute →
 * review → verify → ship → record. One `Card` holds the whole sequence as a
 * divided ordered list, so the reading order IS the flow — no connector glyphs.
 * The failure loop (a failed Verify returns to Plan / Execute) is guidance about
 * the flow rather than a step in it, so it reads as a `RailNote` beneath.
 */
export function LifecycleFlow() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <ol className="divide-y divide-line">
          {LIFECYCLE_STAGES.map((s, i) => (
            <li key={s.stage} className="flex flex-col gap-1.5 px-5 py-4 sm:flex-row sm:gap-5">
              <div className="flex shrink-0 items-baseline gap-2.5 sm:w-44">
                <Eyebrow as="span" className="tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </Eyebrow>
                <Heading as="h4" className="!text-base">
                  {s.stage}
                </Heading>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {s.desc.map((d, j) => (
                  <ProseBlock variant="compact" key={j}>
                    {d}
                  </ProseBlock>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <RailNote icon={<RefreshCw />} title="A failure becomes a fix">
        {
          'A failed **Verify** sends `debug` + `retry` back to Plan / Execute — a failure becomes a fix, not a dead end. We harness the lifecycle; we don’t author it — the engineer still calls what to build and what to merge.'
        }
      </RailNote>
    </div>
  );
}
