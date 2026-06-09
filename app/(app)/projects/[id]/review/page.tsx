import { redirect } from 'next/navigation';

/** Review stage route (Spec 7) — redirect to the unified build monitor. */
export default async function ReviewStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/build`);
}
