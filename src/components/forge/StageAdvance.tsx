'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StageKind } from '@/db/enums';
import { responseError } from '@/lib/err';

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
  irreversible = false,
  busy: busyProp = false,
  projectId,
  from,
  testId,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
  /**
   * Marks an advance that COMMITS something irreversible — the padlock the governance
   * catalogue documents ("black + lock"). It was called `gate`, which reads as "this
   * advance is enforced"; the enforcement is the `projectId && from` transition POST
   * below, which every caller passes and which has nothing to do with this flag. Two
   * different things under one name, and the name belonged to the other one.
   */
  irreversible?: boolean;
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
          setErr(await responseError(res, 'Cannot advance yet.'));
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
        leftIcon={irreversible ? <Lock /> : undefined}
        rightIcon={<ArrowRight />}
        data-testid={testId}
      >
        {busy ? 'Advancing…' : label}
      </Button>
      {err ? <p role="alert" className="text-center text-xs text-[var(--rose)]">{err}</p> : null}
    </div>
  );
}
