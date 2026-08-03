import { ProseBlock } from '@/components/patterns/prose-block';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Eyebrow, Mono } from '@/components/ui/typography';
import {
  JOURNAL_TYPES,
  JOURNAL_RECORD,
  JOURNAL_RECALL,
  JOURNAL_STORE,
  type FlowStep,
} from '@/content/direction-reference';

/**
 * One flow — the route's ordered steps inside a single `Card`: the header names
 * the flow and its endpoint, the divided list carries the steps in order. The
 * ordinal is the only sequence cue; no connectors are drawn between rows.
 */
function Flow({ label, route, steps }: { label: string; route?: string; steps: FlowStep[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="!text-sm">{label}</CardTitle>
        {route && (
          <ProseBlock variant="compact" className="shrink-0 !text-ink-faint">
            {route}
          </ProseBlock>
        )}
      </CardHeader>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.name} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:gap-4">
            <div className="flex shrink-0 items-baseline gap-2.5 sm:w-40">
              <Eyebrow as="span" className="tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </Eyebrow>
              <Mono className="!text-xs font-medium !text-accent-deep">{s.name}</Mono>
            </div>
            <div className="min-w-0 flex-1">
              <ProseBlock variant="compact">{s.detail}</ProseBlock>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The on-disk store the record flow writes into — one row per journal file. */
function Store() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="!text-sm">The store</CardTitle>
        <Mono className="shrink-0 !text-xs !text-ink-faint">.mma/journal/</Mono>
      </CardHeader>
      <div className="divide-y divide-line">
        {JOURNAL_STORE.map((l) => (
          <div key={l.file} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:gap-4">
            <Mono className="shrink-0 !text-xs font-medium !text-accent-deep sm:w-40">{l.file}</Mono>
            <div className="min-w-0 flex-1">
              <ProseBlock variant="compact">{l.holds}</ProseBlock>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Record is the write route: its ordered steps plus the on-disk store the record
 * writes into — so a reader sees how a learning is captured and where it lands.
 */
export function JournalRecordMechanism() {
  return (
    <div className="flex flex-col gap-4">
      <Flow label="The six types" route="one `type` per node · OKF" steps={JOURNAL_TYPES} />
      <Flow label="Record" route="POST /journal-record · write route" steps={JOURNAL_RECORD} />
      <Store />
    </div>
  );
}

/**
 * Recall is the read route: its ordered steps for turning a vague question into
 * the relevant prior learnings gathered back out of the store.
 */
export function JournalRecallMechanism() {
  return (
    <div className="flex flex-col gap-4">
      <Flow label="Recall" route="POST /journal-recall · read route" steps={JOURNAL_RECALL} />
    </div>
  );
}
