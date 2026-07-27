import { WRITE_STAGES } from '@/content/direction-reference';

/**
 * The write-route execution lifecycle as a numbered vertical list — the full
 * set of stages a delegate / execute_plan task runs through, with what each
 * does. (register-block is skipped for write routes; compose + terminal
 * assemble the response.)
 */
export function StageFlow() {
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-1.5">
        {WRITE_STAGES.map((s, i) => (
          <li
            key={s.name}
            className="flex items-baseline gap-3 rounded-[var(--r-md)] border border-line bg-surface p-3"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-[10px] font-semibold text-ink-faint">
              {i + 1}
            </span>
            <code className="shrink-0 text-xs font-semibold text-accent-deep">{s.name}</code>
            <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">{s.what}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs leading-relaxed text-ink-faint">
        <code>register-block</code> is skipped for write routes; <code>compose</code> and <code>terminal</code> assemble and finalize the response.
      </p>
    </div>
  );
}
