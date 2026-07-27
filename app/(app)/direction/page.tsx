'use client';

import { PageFrame } from '@/components/ui';
import { ProseBlock, SectionNavigator } from '@/components/patterns';
import { DirectionSection } from '@/components/direction/DirectionSection';
import { DIRECTION_SECTIONS, MASTHEAD_STATEMENT, PARTS } from '@/content/direction-sections';

/**
 * `/direction` — the whole-product manifesto and user manual, read one section at
 * a time with a part-grouped index and a stable `#section-id` deep link.
 *
 * Authentication is inherited: the page sits under `app/(app)/layout.tsx`, which
 * already resolves the member and redirects to `/login`. No middleware exception
 * and no route-level gate is added here.
 *
 * The canonical content and its renderers are imported ONLY here and from
 * `src/components/direction/**`, so Next's route-level code splitting keeps the
 * manual off every other route's payload (`scripts/check-direction-import-boundary.ts`
 * enforces that boundary).
 */
export default function DirectionPage() {
  return (
    <PageFrame
      title="Direction"
      description="The manifesto and user manual — why the product exists, what it refuses to do, and how every route works."
      width="wide"
    >
      <div className="flex flex-col gap-6">
        <ProseBlock className="rounded-[var(--r-lg)] border border-line bg-surface-2 px-5 py-4">
          {MASTHEAD_STATEMENT}
        </ProseBlock>
        <SectionNavigator sections={DIRECTION_SECTIONS} parts={PARTS}>
          {(section) => <DirectionSection section={section} />}
        </SectionNavigator>
      </div>
    </PageFrame>
  );
}
