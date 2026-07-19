'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  busy: busyProp = false,
  projectId,
  from,
  testId,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
  gate?: boolean;
  /** Caller-driven pending state, for an advance that runs work of its own first. */
  busy?: boolean;
  projectId?: string;
  from?: StageKind;
  testId?: string;
}) {
  const router = useRouter();
  const [busyLocal, setBusyLocal] = useState(false);
  const busy = busyLocal || busyProp;
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    if (onClick) { onClick(); return; }
    if (!href) return;

    if (projectId && from) {
      setBusyLocal(true);
      setErr(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `from` lets the server treat an advance of an ALREADY-advanced (done) stage
          // as an idempotent success (→ we navigate). A genuine "can't advance yet"
          // (from-stage still active/unready) is still a 409 and we stay put — routing
          // forward there is the read-a-half-advanced-project bug.
          body: JSON.stringify({ action: FROM_ACTION[from], from }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setErr(d.error ?? 'Cannot advance yet.');
          setBusyLocal(false);
          return;
        }
      } catch {
        setErr('Network error — try again.');
        setBusyLocal(false);
        return;
      }
      setBusyLocal(false);
    }

    router.push(href);
    router.refresh();
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <Button
        variant="solid"
        fullWidth
        onClick={handleClick}
        disabled={disabled || busy}
        leftIcon={gate ? <Lock /> : undefined}
        rightIcon={<ArrowRight />}
        data-testid={testId}
      >
        {busy ? 'Advancing…' : label}
      </Button>
      {err ? <p className="text-center text-xs text-[var(--rose-deep)]">{err}</p> : null}
    </div>
  );
}
