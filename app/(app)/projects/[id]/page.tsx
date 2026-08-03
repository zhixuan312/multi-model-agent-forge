import { notFound, redirect } from 'next/navigation';
import { getProject } from '@/projects/projects-core';
import { requireProjectAccess } from '@/projects/require-project-access';
import { stageRoute } from '@/projects/stage-route';

/**
 * Project index — redirect to the current stage via the `STAGE_ROUTE` map; for a
 * fresh project that is `/explore`.
 * (There is no `/build` special case: that segment was a redirect alias to
 * `/execute` that nothing linked to, and it has been removed.)
 *
 * Gated like every other project surface. It used to rely on the LAYOUT's guard, which
 * renders concurrently with the page — so this read the project row and could redirect
 * on its `currentStage` before that guard resolved. Nothing leaked (the destination
 * gates too), but the correctness depended on render ordering for no reason.
 */
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireProjectAccess(id);

  const project = await getProject(id);
  if (!project) notFound();
  redirect(stageRoute(project.currentStage ?? 'exploration', id));
}
