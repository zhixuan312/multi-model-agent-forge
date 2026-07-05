'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StageKind } from '@/db/enums';

// The stage-to-stage advance is a unified transition: spec/plan sign off via
// approve_stage (Forge is added to the stage's approvals then the stage advances);
// exploration/execute/review carry no sign-off, so they advance_stage directly.
const FROM_ACTION: Record<StageKind, 'approve_stage' | 'advance_stage'> = {
  exploration: 'advance_stage',
  spec: 'approve_stage',
  plan: 'approve_stage',
  execute: 'advance_stage',
  review: 'advance_stage',
  journal: 'advance_stage',
};

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
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    if (onClick) { onClick(); return; }
    if (!href) return;

    if (projectId && from) {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: FROM_ACTION[from] }),
        });
        if (!res.ok) {
          // Do NOT navigate on a rejected transition — routing forward without an
          // actual stage advance is exactly the read-a-half-advanced-project bug.
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setErr(d.error ?? 'Cannot advance yet.');
          setBusy(false);
          return;
        }
      } catch {
        setErr('Network error — try again.');
        setBusy(false);
        return;
      }
      setBusy(false);
    }

    router.push(href);
    router.refresh();
  }

  const cls = cn(
    'inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] px-4 py-2 text-sm font-medium transition-colors',
    disabled || busy ? 'pointer-events-none cursor-not-allowed bg-ink/30 text-white/50' : 'bg-ink text-white hover:bg-ink/90',
  );

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={handleClick} disabled={disabled || busy} className={cls} data-testid={testId}>
        {gate ? <Lock aria-hidden="true" className="size-4" /> : null}
        {busy ? 'Advancing…' : label}
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
      {err ? <p className="text-center text-xs text-[var(--rose-deep)]">{err}</p> : null}
    </div>
  );
}
