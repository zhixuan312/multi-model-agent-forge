import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { loadBuildView } from '@/build/build-core';
import { BuildMonitor } from '@/components/forge/BuildMonitor';
import { USE_MOCK } from '@/mock/config';
import { StagePlaceholder } from '@/components/forge/StagePlaceholder';

/**
 * Build pipeline route (Spec 7 §UI). RSC first paint loads the plan + plan_task +
 * audit-pass ledger; the client `BuildMonitor` island subscribes to the SSE bus.
 * `data-phase='build'` comes from the project layout. Reached when the project's
 * phase is build/done (the plan/execute/review stage routes redirect here).
 */
export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  if (USE_MOCK) return <StagePlaceholder stage="Build" />;

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const project = await getProject(id);
  if (!project) notFound();

  const view = await loadBuildView(getDb(), id);

  return <BuildMonitor projectId={id} initial={view} />;
}
