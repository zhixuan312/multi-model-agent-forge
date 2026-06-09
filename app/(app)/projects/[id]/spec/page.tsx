import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { agentTier, provider } from '@/db/schema/config';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { ensureSpecStage, loadOutline } from '@/spec/spec-core';
import { getLatestSpec } from '@/spec/assemble';
import { defaultComponentKinds } from '@/spec/components';
import { SpecStageClient } from '@/components/forge/SpecStageClient';

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

  return (
    <SpecStageClient
      projectId={id}
      projectName={proj.name}
      intentMd={proj.intentMd}
      phase={proj.phase}
      mainTierReady={mainTierReady}
      defaultKinds={defaultComponentKinds()}
      initialComponents={components}
      initialSpec={latestSpec ? { version: latestSpec.version, bodyMd: latestSpec.bodyMd } : null}
    />
  );
}

/** True iff the `main` tier points at a configured claude provider with an api_key_ref. */
async function isMainTierReady(db: ReturnType<typeof getDb>): Promise<boolean> {
  const [tier] = await db
    .select({ providerId: agentTier.providerId })
    .from(agentTier)
    .where(eq(agentTier.tier, 'main'))
    .limit(1);
  if (!tier?.providerId) return process.env.ANTHROPIC_API_KEY != null && process.env.ANTHROPIC_API_KEY !== '';
  const [prov] = await db
    .select({ type: provider.type, apiKeyRef: provider.apiKeyRef })
    .from(provider)
    .where(eq(provider.id, tier.providerId))
    .limit(1);
  if (prov?.type === 'claude' && prov.apiKeyRef) return true;
  return process.env.ANTHROPIC_API_KEY != null && process.env.ANTHROPIC_API_KEY !== '';
}
