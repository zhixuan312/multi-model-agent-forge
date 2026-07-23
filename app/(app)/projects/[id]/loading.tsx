import { Spinner } from '@/components/ui';

/**
 * Route-level loading UI for a project stage. Stage pages are async RSCs doing multi-read fetches;
 * without this, navigating to a slow stage showed the OLD page frozen until every await resolved.
 * This surfaces an immediate spinner via Suspense so the transition reads as loading, not stuck.
 */
export default function ProjectLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center py-24">
      <Spinner label="Loading stage" />
    </div>
  );
}
