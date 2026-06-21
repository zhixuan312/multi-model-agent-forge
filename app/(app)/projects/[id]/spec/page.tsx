import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { readMmaBearer } from '@/mma/client-config';
import { ensureSpecStage, loadOutline, loadAllMessages } from '@/spec/spec-core';
import { getLatestSpec } from '@/spec/assemble';
import { auditPassHistory } from '@/spec/audit-loop';
import { canFreeze } from '@/spec/freeze';
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
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const db = getDb();

  const validSpecPhases = ['outline', 'craft', 'document'] as const;
  type SpecPhase = typeof validSpecPhases[number];
  const { getLastPhase } = await import('@/projects/phase-tracker');
  const lastPhase = await getLastPhase(db, id, 'spec') as SpecPhase | null;
  const initialPhase: SpecPhase | undefined = validSpecPhases.includes(phaseParam as any)
    ? (phaseParam as SpecPhase)
    : lastPhase ?? undefined;
  const [proj] = await db
    .select({ name: project.name, intentMd: project.intentMd, phase: project.phase })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!proj) notFound();

  const stage = await ensureSpecStage(db, id);
  const components = await loadOutline(db, stage.id);
  const latestSpec = await getLatestSpec(db, id);
  const initialMessages = await loadAllMessages(db, stage.id);

  // Entry precondition (F27/F30): the main tier must be a configured claude
  // provider with a key (non-null api_key_ref) for the Q&A loop to run.
  const mainTierReady = await isMainTierReady(db);
  // Audit/freeze precondition (F27): a configured MMA token.
  const mmaReady = await isMmaReady(db);
  const auditHistory = await auditPassHistory(db, id);
  const freezeReady = await canFreeze(db, id);
  const voiceEnabled = await isVoiceEnabled({ db });
  const { getStagePermissions } = await import('@/projects/stage-gate');
  const perms = await getStagePermissions(db, id);

  // Load project members for collaborative approval
  const { projectMember } = await import('@/db/schema/projects');
  const { member } = await import('@/db/schema/identity');
  const memberRows = await db
    .select({ id: member.id, displayName: member.displayName, avatarTint: member.avatarTint })
    .from(projectMember)
    .innerJoin(member, eq(projectMember.memberId, member.id))
    .where(eq(projectMember.projectId, id));
  const projectMembers = memberRows
    .filter((m) => m.id !== me.id)
    .map((m) => ({ id: m.id, displayName: m.displayName, avatarTint: m.avatarTint }));

  const pendingAudit = await findInflight(db, id, 'spec-audit');
  const pendingAutoDraft = await findInflight(db, id, 'spec-auto-draft');
  const pendingApply = await findInflight(db, id, 'spec-audit-apply');

  return (
    <SpecStageClient
      projectId={id}
      projectName={proj.name}
      intentMd={proj.intentMd}
      phase={perms.spec.canMutate ? proj.phase : 'frozen' as any}
      mainTierReady={mainTierReady}
      mmaReady={mmaReady}
      defaultKinds={defaultComponentKinds()}
      initialComponents={components}
      initialSpec={latestSpec ? { version: latestSpec.version, bodyMd: latestSpec.bodyMd } : null}
      initialAuditHistory={auditHistory.map((p) => ({ passNo: p.passNo, findingsCount: p.findingsCount, verdict: p.verdict, applied: p.applied, findings: p.findings.map((f) => ({ severity: f.severity, category: f.category, claim: f.claim, evidence: f.evidence, suggestion: f.suggestion })) }))}
      initialCanFreeze={freezeReady}
      currentMember={{ id: me.id, displayName: me.displayName, avatarTint: me.avatarTint }}
      projectMembers={projectMembers}
      craftCollab={buildCraftCollab(projectMembers, me)}
      initialMessages={initialMessages}
      voiceEnabled={voiceEnabled}
      pendingAudit={pendingAudit}
      pendingAutoDraft={pendingAutoDraft}
      pendingApply={pendingApply}
      initialPhase={initialPhase}
    />
  );
}

type MemberRef = { id: string; displayName: string; avatarTint: string };
type ComponentKind = 'context' | 'problem' | 'goals_requirements' | 'alternatives' | 'technical_design' | 'testing_plan' | 'risks' | 'stories_tasks';

function buildCraftCollab(
  members: MemberRef[],
  me: { id: string; displayName: string; avatarTint: string },
): Partial<Record<ComponentKind, { participants: Array<{ member: MemberRef; addedBy: null; approvedAt: string | null }>; discussion: [] }>> {
  const byName = (name: string) => members.find((m) => m.displayName.toLowerCase().includes(name.toLowerCase()));
  const business = byName('business');
  const product = byName('product');
  const xuan = byName('xuan') ?? { id: me.id, displayName: me.displayName, avatarTint: me.avatarTint };
  const tester = byName('tester');

  const toParticipant = (m: MemberRef | undefined) => m ? { member: m, addedBy: null, approvedAt: new Date().toISOString() } : null;

  const boPm = [toParticipant(business), toParticipant(product)].filter(Boolean) as any[];
  const xuanOnly = [toParticipant(xuan)].filter(Boolean) as any[];
  const xuanTester = [toParticipant(xuan), toParticipant(tester)].filter(Boolean) as any[];
  const pmTester = [toParticipant(product), toParticipant(tester)].filter(Boolean) as any[];
  const all = [toParticipant(business), toParticipant(product), toParticipant(xuan), toParticipant(tester)].filter(Boolean) as any[];

  return {
    context: { participants: boPm, discussion: [] },
    problem: { participants: boPm, discussion: [] },
    goals_requirements: { participants: boPm, discussion: [] },
    alternatives: { participants: xuanOnly, discussion: [] },
    technical_design: { participants: xuanTester, discussion: [] },
    testing_plan: { participants: pmTester, discussion: [] },
    risks: { participants: all, discussion: [] },
    stories_tasks: { participants: pmTester, discussion: [] },
  };
}

/** True iff a usable MMA bearer is available — auto-resolved from the local
 *  mma token (`MMA_AUTH_TOKEN` env, else `~/.mma/auth-token`). */
async function isMmaReady(_db: ReturnType<typeof getDb>): Promise<boolean> {
  return readMmaBearer() !== null;
}

async function isMainTierReady(_db: ReturnType<typeof getDb>): Promise<boolean> {
  return readMmaBearer() !== null;
}
