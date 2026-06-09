import { redirect } from 'next/navigation';

/**
 * Plan stage route (Spec 7) — the plan/execute/review stages share one build
 * monitor at `/build`. Redirect there.
 */
export default async function PlanStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/build`);
}
