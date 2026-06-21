'use client';

import { Lock } from 'lucide-react';
import { Banner } from '@/components/ui';

export function LockedBanner({ reason }: { reason: string }) {
  return (
    <Banner
      variant="info"
      title={
        <span className="flex items-center gap-2">
          <Lock className="size-4" />
          This stage is locked
        </span>
      }
      description={reason + ' You can review everything but edits are disabled.'}
    />
  );
}
