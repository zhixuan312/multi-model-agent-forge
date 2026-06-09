import { notFound, redirect } from 'next/navigation';
import { getProject } from '@/projects/projects-core';
import { projectIndexTarget } from '@/projects/index-target';

/**
 * Project index (Spec 3 flow 3 / Spec 7 F11) — redirect to the current stage via
 * the `STAGE_ROUTE` map, EXCEPT a `build`/`done`-phase project goes straight to
 * the build monitor (`/build`). For a fresh project this is `/explore`. The
 * layout already ran the visibility guard.
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
