import { Hammer } from 'lucide-react';
import { EmptyState } from '@/components/ui';

/**
 * StagePlaceholder — shown for per-project stages whose mock walk-through hasn't
 * been built yet. Keeps the flow navigable (the stepper never dead-ends or
 * crashes) while we build each stage's mock content one pass at a time.
 */
export function StagePlaceholder({ stage }: { stage: string }) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Hammer />}
        title={`${stage} — coming in the next pass`}
        description="Exploration is wired with mock content; this stage's walk-through lands in an upcoming pass. The stepper navigation already works."
      />
    </div>
  );
}
