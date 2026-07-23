import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { EmptyState, buttonVariants } from '@/components/ui';

/**
 * In-shell 404. The ~10 pages that call `notFound()` (an invalid/inaccessible project id, a stale
 * link, a permission miss mapped to notFound for anti-enumeration) previously rendered Next's bare
 * default 404 OUTSIDE the app shell with no way back. This renders inside the shell with a route home.
 */
export default function NotFound() {
  return (
    <EmptyState
      icon={<SearchX />}
      title="Not found"
      description="This page doesn't exist, or you don't have access to it."
      action={
        <Link href="/" className={buttonVariants({ variant: 'primary' })}>
          Back to projects
        </Link>
      }
    />
  );
}
