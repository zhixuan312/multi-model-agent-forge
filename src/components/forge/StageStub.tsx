/**
 * StageStub (Spec 3) — the shared empty-panel element every stage route renders
 * until its real content lands (Specs 4/5/7). `locked` stubs note that the stage
 * is gated until earlier stages complete.
 */
export function StageStub({
  title,
  comingIn,
  locked = false,
}: {
  title: string;
  comingIn: string;
  locked?: boolean;
}) {
  return (
    <div className="grid place-items-center rounded-[var(--r-lg)] border border-dashed border-line bg-surface-2 px-6 py-20 text-center">
      <p className="font-serif text-lg italic text-ink-faint">
        {locked ? '🔒 ' : ''}
        {title}
      </p>
      <p className="mt-1 text-xs text-ink-faint">Coming in {comingIn}.</p>
    </div>
  );
}
