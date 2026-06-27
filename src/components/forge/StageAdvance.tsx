'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StageKind } from '@/db/enums';

export function StageAdvance({
  href,
  onClick,
  label,
  disabled = false,
  gate = false,
  projectId,
  from,
  testId,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
  gate?: boolean;
  projectId?: string;
  from?: StageKind;
  testId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (onClick) { onClick(); return; }
    if (!href) return;

    if (projectId && from) {
      setBusy(true);
      try {
        await fetch(`/api/projects/${projectId}/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from }),
        });
      } catch {
        // Navigate anyway — the advance is idempotent on retry.
      } finally {
        setBusy(false);
      }
    }

    router.push(href);
    router.refresh();
  }

  const cls = cn(
    'inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] px-4 py-2 text-sm font-medium transition-colors',
    disabled || busy ? 'pointer-events-none cursor-not-allowed bg-ink/30 text-white/50' : 'bg-ink text-white hover:bg-ink/90',
  );

  return (
    <button type="button" onClick={handleClick} disabled={disabled || busy} className={cls} data-testid={testId}>
      {gate ? <Lock aria-hidden="true" className="size-4" /> : null}
      {busy ? 'Advancing…' : label}
      <ArrowRight aria-hidden="true" className="size-4" />
    </button>
  );
}
