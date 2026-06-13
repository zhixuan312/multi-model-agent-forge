import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { USE_MOCK } from '@/mock/config';
import { mockPlan } from '@/mock/domains/projects/plan';
import { PlanStageClient } from '@/components/forge/PlanStageClient';

/**
 * Plan stage (DESIGN group) — the implementation plan is written straight from
 * the spec in the writing-plans-skill shape (phases of bite-sized TDD tasks for
 * engineers): Decompose → Detail → Validate, then "Lock the plan" opens BUILD.
 * Automated mode (offered once the spec is done) can drive the whole loop.
 */
export default async function PlanStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  if (USE_MOCK) {
    const m = mockPlan(id);
    return (
      <PlanStageClient
        projectId={id}
        projectName={m.projectName}
        intentMd={m.intentMd}
        phase={m.phase}
        mmaReady={m.mmaReady}
        phases={m.phases}
        planMd={m.planMd}
        auditRounds={m.auditRounds}
      />
    );
  }

  // Real backend wiring lands with the build-stage work; for now the planning UI
  // is mock-driven (the legacy build monitor lives at /build).
  redirect(`/projects/${id}/build`);
}
