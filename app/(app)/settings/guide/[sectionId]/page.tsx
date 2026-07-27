import { redirect } from 'next/navigation';
import { PageFrame } from '@/components/ui';
import { DirectionSection } from '@/components/direction/DirectionSection';
import { DIRECTION_SECTIONS } from '@/content/direction-sections';

/**
 * One Guide section on its own page — the product manual, read one section at a
 * time. The section index lives in the left rail (`renderGuideSections()` in the
 * Sidebar), so this page carries NO in-content navigation and no masthead: the
 * centre area shows exactly the selected section.
 *
 * Authentication is inherited from `app/(app)/layout.tsx`, which resolves the
 * member and redirects to `/login`. The Guide is universal — every authenticated
 * role reads the same manual, so there is no role gate here.
 *
 * The canonical content and its renderers are imported ONLY from this route tree
 * and `src/components/direction/**`, so Next's route-level code splitting keeps
 * the manual off every other route's payload
 * (`scripts/check-direction-import-boundary.ts` enforces that boundary).
 */
export default async function GuideSectionPage({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  const section = DIRECTION_SECTIONS.find((s) => s.id === sectionId);
  // An unknown id is a stale link, not a dead end — land the reader on the manual's
  // opening section rather than a 404.
  if (!section) redirect(`/settings/guide/${DIRECTION_SECTIONS[0].id}`);

  return (
    <PageFrame title="Guide" width="full">
      <DirectionSection section={section} />
    </PageFrame>
  );
}
