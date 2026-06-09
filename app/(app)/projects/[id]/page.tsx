import { notFound, redirect } from 'next/navigation';
import { getProject } from '@/projects/projects-core';
import { stageRoute } from '@/projects/stage-route';

/**
 * Project index (Spec 3 flow 3) — redirect to the current stage via the
 * `STAGE_ROUTE` map. For a fresh project (`current_stage='exploration'`) this is
 * `/projects/<id>/explore` (never `/exploration`, which has no route file). The
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
  const target = project.currentStage ?? 'exploration';
  redirect(stageRoute(target, id));
}
