'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EmptyState, Button, Mono } from '@/components/ui';

/**
 * Project-scoped error boundary — keeps a stage-render failure contained to the stage panel (the
 * project shell + stepper live above this boundary) instead of taking down the whole app.
 */
/**
 * The `digest` is the only handle on a production error.
 *
 * Next strips the message from a server-side throw before it reaches the browser and hands
 * back a `digest` that matches the one it logged. All three boundaries destructured it and
 * rendered none of it, so a user reporting "Something went wrong" gave support nothing to
 * correlate — the identifier existed, travelled to the client, and was dropped on the floor.
 */
function ErrorDigest({ digest }: { digest?: string }) {
  if (!digest) return null;
  return (
    <Mono className="!text-xs !text-ink-faint">
      Reference: {digest}
    </Mono>
  );
}

export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Project route error:', error);
  }, [error]);

  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="This stage failed to load"
      description="Something went wrong rendering this stage. Retry, or switch stages from the stepper."
      action={
        <div className="flex flex-col items-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <ErrorDigest digest={error.digest} />
        </div>
      }
    />
  );
}
