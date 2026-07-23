'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EmptyState, Button } from '@/components/ui';

/**
 * Project-scoped error boundary — keeps a stage-render failure contained to the stage panel (the
 * project shell + stepper live above this boundary) instead of taking down the whole app.
 */
export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Project route error:', error);
  }, [error]);

  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="This stage failed to load"
      description="Something went wrong rendering this stage. Retry, or switch stages from the stepper."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
