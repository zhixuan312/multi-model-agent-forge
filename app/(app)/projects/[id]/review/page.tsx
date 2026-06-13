import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { USE_MOCK } from '@/mock/config';
import { mockReview } from '@/mock/domains/projects/review';
import { ReviewStageClient } from '@/components/forge/ReviewStageClient';

/**
 * Review stage (BUILD group) — code review of the landed changeset: Inspect →
 * Judge → Resolve. The Judge phase mirrors the spec/plan audit interface
 * (numbered, selectable findings); MMA code-review or a human drives it.
 */
export default async function ReviewStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  if (USE_MOCK) {
    const m = mockReview(id);
    return (
      <ReviewStageClient
        projectId={id}
        projectName={m.projectName}
        phase="build"
        mmaReady={m.mmaReady}
        units={m.units}
        reviewRounds={m.reviewRounds}
      />
    );
  }

  redirect(`/projects/${id}/build`);
}
