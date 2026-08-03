import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { requireProjectAccess } from '@/projects/require-project-access';
import { readMmaBearer } from '@/mma/client-config';
import { ensureSpecStage, loadOutline, loadAllMessages } from '@/spec/spec-core';
import { getLatestSpec } from '@/spec/assemble';
import { auditPassHistory } from '@/spec/audit-loop';
import { defaultComponentKinds } from '@/spec/components';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import { isVoiceEnabled } from '@/config/connections-core';
import { findInflight } from '@/dispatch/dispatch-helpers';

/**
 * Spec stage (Spec 4 Part A) — the per-section dynamic Q&A authoring slice. RSC
 * first paint: resolves the spec stage (lazy create → active, F10), checks the
 * entry precondition (a configured `main` tier — F27/F30), loads the outline +
 * latest assembled spec, and hands the interview/document islands to the client.
 */
export default async function SpecStagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ phase?: string }>;
}) {
  const { id } = await params;
  const { phase: phaseParam } = await searchParams;
  const { me } = await requireProjectAccess(id);

  const db = getDb();

  const validSpecPhases = ['outline', 'craft', 'finalize'] as const;
  type SpecPhase = typeof validSpecPhases[number];
  const { getActivePhase } = await import('@/projects/phase-tracker');
  const lastPhase = await getActivePhase(db, id, 'spec') as SpecPhase | null;
  const initialPhase: SpecPhase | undefined = phaseParam != null && (validSpecPhases as readonly string[]).includes(phaseParam)
    ? (phaseParam as SpecPhase)
    : lastPhase ?? undefined;
  const [proj] = await db
    .select({ name: project.name, intentMd: project.intentMd, phase: project.phase })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!proj) notFound();

  // Runs before loadOutline: it flips a pending spec stage to active in `details`, which
  // the outline then reads.
  const { approvers: specApprovers } = await ensureSpecStage(db, id);
  const components = await loadOutline(db, id);
  const latestSpec = await getLatestSpec(db, id);
  const initialMessages = await loadAllMessages(db, id);
  // Entry precondition (F27/F30): the main tier must be a configured claude
  // provider with a key (non-null api_key_ref) for the Q&A loop to run.
  const mainTierReady = hasMmaToken();
  const mmaReady = hasMmaToken();
  const auditHistory = await auditPassHistory(db, id);
  const voiceEnabled = await isVoiceEnabled({ db });
  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  // Load project members for collaborative approval
  // Team-scoped (FR-9): the invite / @-mention pool is this team's members, never every
  // member of every team. `listTeamMemberRefs` is the one implementation of that scope.
  const { listTeamMemberRefs } = await import('@/auth/members-core');
  const projectMembers = (await listTeamMemberRefs(me.teamId, { db })).filter((m) => m.id !== me.id);

  const pendingAutoDraft = await findInflight(db, id, 'spec-auto-draft');
  const pendingApply = await findInflight(db, id, 'spec-audit-apply');

  return (
    <SpecStageClient
      projectId={id}
      projectName={proj.name}
      intentMd={proj.intentMd}
      phase={perms.spec.canMutate ? proj.phase : 'build'}
      mainTierReady={mainTierReady}
      mmaReady={mmaReady}
      defaultKinds={defaultComponentKinds()}
      initialComponents={components}
      initialSpec={latestSpec ? { version: latestSpec.version, bodyMd: latestSpec.bodyMd } : null}
      initialAuditHistory={
        /* Narrows the server row to what the client needs (`createdAt` is unused there).
           Findings pass straight through: `ParsedFinding` extends the same `Finding`
           contract the grid renders, so there is nothing to remap field by field. */
        auditHistory.map((p) => ({ passNo: p.passNo, findingsCount: p.findingsCount, verdict: p.verdict, applied: p.applied, appliedIndices: p.appliedIndices, findings: p.findings }))
      }
      currentMember={{ id: me.id, displayName: me.displayName, avatarTint: me.avatarTint }}
      projectMembers={projectMembers}
      initialMessages={initialMessages}
      voiceEnabled={voiceEnabled}
      pendingAutoDraft={pendingAutoDraft}
      pendingApply={pendingApply}
      specApprovers={specApprovers}
      initialPhase={initialPhase}
      readOnly={!perms.spec.canMutate}
      lockedReason={perms.spec.reason}
    />
  );
}

function hasMmaToken(): boolean {
  return readMmaBearer() !== null;
}
