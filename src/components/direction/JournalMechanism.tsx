import { ProseBlock } from '@/components/patterns';
import {
  JOURNAL_TYPES,
  JOURNAL_RECORD,
  JOURNAL_RECALL,
  JOURNAL_STORE,
  type FlowStep,
} from '@/content/direction-reference';

function FlowHead({ label, route }: { label: string; route?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {route && <code className="text-[0.6875rem] text-ink-faint">{route}</code>}
    </div>
  );
}

function Flow({ label, route, steps }: { label: string; route?: string; steps: FlowStep[] }) {
  return (
    <div className="flex flex-col gap-2">
      <FlowHead label={label} route={route} />
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li
            key={s.name}
            className="flex items-baseline gap-3 rounded-[var(--r-md)] border border-line bg-surface p-3"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-[10px] font-semibold text-ink-faint">
              {i + 1}
            </span>
            <code className="w-24 shrink-0 text-xs font-semibold text-accent-deep">{s.name}</code>
            <div className="min-w-0 flex-1">
              <ProseBlock variant="compact">{s.detail}</ProseBlock>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Store() {
  return (
    <div className="flex flex-col gap-2">
      <FlowHead label="The store" route=".mma/journal/" />
      <div className="flex flex-col gap-1.5">
        {JOURNAL_STORE.map((l) => (
          <div
            key={l.file}
            className="flex items-baseline gap-3 rounded-[var(--r-md)] border border-line bg-surface p-3"
          >
            <code className="w-32 shrink-0 text-xs font-semibold text-accent-deep">{l.file}</code>
            <div className="min-w-0 flex-1">
              <ProseBlock variant="compact">{l.holds}</ProseBlock>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Record is the write route: its ordered steps plus the on-disk store the record
 * writes into — so a reader sees how a learning is captured and where it lands.
 */
export function JournalRecordMechanism() {
  return (
    <div className="flex flex-col gap-5">
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
    <div className="flex flex-col gap-5">
      <Flow label="Recall" route="POST /journal-recall · read route" steps={JOURNAL_RECALL} />
    </div>
  );
}
