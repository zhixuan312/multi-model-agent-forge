'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EmptyState, Button } from '@/components/ui';

/**
 * App-shell error boundary. Without this, any server-component throw on a page (a transient DB/store
 * read failure on a stage, the layout's notification load, etc.) fell through to Next's bare root
 * fallback — the whole app shell vanished with no recovery. This keeps the sidebar/nav mounted (the
 * layout is above this boundary) and offers a retry.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('App route error:', error);
  }, [error]);

  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="Something went wrong"
      description="This view failed to load. It may be a transient issue — try again."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
