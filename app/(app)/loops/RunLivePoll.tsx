'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Live-updates the loop run history while a run is in progress. The activity page is a
 * one-shot server render, so a `running` run would otherwise sit "in progress" until a manual
 * reload. While `active`, refetch the server component on an interval; when the run reaches a
 * terminal state the refetch re-renders with `active=false` and the poll stops. Renders nothing.
 */
export function RunLivePoll({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
