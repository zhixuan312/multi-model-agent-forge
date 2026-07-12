'use client';

import { ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { automationOverlayStore } from '@/components/forge/AutomationGate';

/**
 * Opens the activity overlay READ-ONLY to show the project's full event timeline
 * (`project_activity`) — the way a completed (non-auto) project surfaces its record.
 * Renders nothing when there's no activity yet. The overlay itself reads the
 * events from server state, so this only flips it visible.
 */
export function ViewActivityButton({ eventCount }: { eventCount: number }) {
  if (!eventCount) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<ListTree />}
      onClick={() => automationOverlayStore.view()}
    >
      Activity
    </Button>
  );
}
