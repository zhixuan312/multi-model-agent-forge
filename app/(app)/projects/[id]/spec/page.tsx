import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { agentTier, provider } from '@/db/schema/config';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { readDevTokenFallback } from '@/mma/client-config';
import { ensureSpecStage, loadOutline } from '@/spec/spec-core';
import { getLatestSpec } from '@/spec/assemble';
import { auditPassHistory } from '@/spec/audit-loop';
import { canFreeze } from '@/spec/freeze';
import { defaultComponentKinds } from '@/spec/components';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import { AnthropicClient } from '@/anthropic/client';
import { USE_MOCK } from '@/mock/config';
import { mockSpec } from '@/mock/domains/projects/spec';

/**
 * Spec stage (Spec 4 Part A) — the per-section dynamic Q&A authoring slice. RSC
 * first paint: resolves the spec stage (lazy create → active, F10), checks the
 * entry precondition (a configured `main` tier — F27/F30), loads the outline +
 * latest assembled spec, and hands the interview/document islands to the client.
 */
export default async function SpecStagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  if (USE_MOCK) {
    const m = mockSpec(id);
    return (
      <SpecStageClient
        projectId={id}
        projectName={m.projectName}
        intentMd={m.intentMd}
        phase={m.phase}
        mainTierReady={m.mainTierReady}
        mmaReady={m.mmaReady}
        defaultKinds={m.defaultKinds}
        initialComponents={m.initialComponents}
        initialSpec={m.initialSpec}
        initialAuditHistory={m.initialAuditHistory}
        initialCanFreeze={m.initialCanFreeze}
        craftContent={m.craftContent}
        currentMember={{ id: me.id, displayName: me.displayName, avatarTint: me.avatarTint }}
        projectMembers={m.projectMembers}
        craftCollab={m.craftCollab}
      />
    );
  }

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const db = getDb();
  const [proj] = await db
    .select({ name: project.name, intentMd: project.intentMd, phase: project.phase })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!proj) notFound();

  const stage = await ensureSpecStage(db, id);
  const components = await loadOutline(db, stage.id);
  const latestSpec = await getLatestSpec(db, id);

  // Entry precondition (F27/F30): the main tier must be a configured claude
  // provider with a key (non-null api_key_ref) for the Q&A loop to run.
  const mainTierReady = await isMainTierReady(db);
  // Audit/freeze precondition (F27): a configured MMA token.
  const mmaReady = await isMmaReady(db);
  const auditHistory = await auditPassHistory(db, id);
  const freezeReady = await canFreeze(db, id);

  return (
    <SpecStageClient
      projectId={id}
      projectName={proj.name}
      intentMd={proj.intentMd}
      phase={proj.phase}
      mainTierReady={mainTierReady}
      mmaReady={mmaReady}
      defaultKinds={defaultComponentKinds()}
      initialComponents={components}
      initialSpec={latestSpec ? { version: latestSpec.version, bodyMd: latestSpec.bodyMd } : null}
      initialAuditHistory={auditHistory.map((p) => ({ passNo: p.passNo, findingsCount: p.findingsCount, verdict: p.verdict }))}
      initialCanFreeze={freezeReady}
      currentMember={{ id: me.id, displayName: me.displayName, avatarTint: me.avatarTint }}
    />
  );
}

/** True iff a usable MMA bearer is available — auto-resolved from the local
 *  mmagent token (`MMAGENT_AUTH_TOKEN` env, else `~/.multi-model/auth-token`). */
async function isMmaReady(_db: ReturnType<typeof getDb>): Promise<boolean> {
  return readDevTokenFallback() !== null;
}

/** True iff the `main` tier points at a configured claude provider with an api_key_ref. */
/**
 * The main tier is ready when any auth resolves: an explicit provider key, the
 * server's Claude Code subscription OAuth, or an env key. Defer to the canonical
 * resolver so the precedence stays in one place.
 */
async function isMainTierReady(db: ReturnType<typeof getDb>): Promise<boolean> {
  try {
    await AnthropicClient.resolveMainTier({ db });
    return true;
  } catch {
    return false;
  }
}
