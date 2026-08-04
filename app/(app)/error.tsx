'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EmptyState, Button, Mono } from '@/components/ui';

/**
 * App-shell error boundary. Without this, any server-component throw on a page (a transient DB/store
 * read failure on a stage, the layout's notification load, etc.) fell through to Next's bare root
 * fallback — the whole app shell vanished with no recovery. This keeps the sidebar/nav mounted (the
 * layout is above this boundary) and offers a retry.
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

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('App route error:', error);
  }, [error]);

  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="Something went wrong"
      description="This view failed to load. It may be a transient issue — try again."
      action={
        <div className="flex flex-col items-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <ErrorDigest digest={error.digest} />
        </div>
      }
    />
  );
}
