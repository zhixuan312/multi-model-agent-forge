import { Lock, Hourglass } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * StageStub (Spec 3) — the shared empty-panel element a stage route renders until
 * its real content lands (Specs 4/5/7). `locked` stubs note that the stage is
 * gated until earlier stages complete.
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
    <EmptyState
      icon={locked ? <Lock /> : <Hourglass />}
      title={title}
      description={`Coming in ${comingIn}.`}
    />
  );
}
