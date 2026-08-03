import { Card } from '@/components/ui/card';
import { Eyebrow, Mono, TextSm } from '@/components/ui/typography';
import { WRITE_STAGES } from '@/content/direction-reference';

/**
 * The write-route execution sequence — what a delegate / execute_plan task runs
 * through, with what each step does. One `Card` carrying a divided ordered list: the
 * order is the sequence, so no connectors are drawn.
 */
export function StageFlow() {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ol className="divide-y divide-line">
          {WRITE_STAGES.map((s, i) => (
            <li key={s.name} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-4">
              <div className="flex shrink-0 items-baseline gap-2.5 sm:w-40">
                <Eyebrow as="span" className="tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </Eyebrow>
                <Mono className="!text-xs font-medium !text-accent-deep">{s.name}</Mono>
              </div>
              <TextSm className="min-w-0 flex-1 !text-xs">{s.what}</TextSm>
            </li>
          ))}
        </ol>
      </Card>
      <TextSm className="!text-xs !text-ink-faint">
        Read routes stop after <Mono className="!text-xs">refine</Mono> — they produce findings, not a
        diff, so nothing is committed.
      </TextSm>
    </div>
  );
}
