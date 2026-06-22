import { redirect } from 'next/navigation';

/**
 * `/projects/[id]/build` — redirects to the execute stage page. The execute page
 * owns the full dispatch → run → land flow with real-time SSE progress.
 */
export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/execute`);
}
