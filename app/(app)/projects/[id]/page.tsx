import { notFound, redirect } from 'next/navigation';
import { getProject } from '@/projects/projects-core';
import { projectIndexTarget } from '@/projects/index-target';

/**
 * Project index — redirect to the current stage via the `STAGE_ROUTE` map; for a
 * fresh project that is `/explore`. The layout already ran the visibility guard.
 * (There is no `/build` special case: that segment was a redirect alias to
 * `/execute` that nothing linked to, and it has been removed.)
 */
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();
  redirect(projectIndexTarget(id, project.phase, project.currentStage ?? 'exploration'));
}
