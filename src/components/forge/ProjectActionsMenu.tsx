'use client';

import { useRouter } from 'next/navigation';
import { MoreHorizontal, ListTree, ArchiveX, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui';
import { automationOverlayStore } from '@/components/forge/AutomationGate';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { responseError } from '@/lib/err';

/**
 * `ProjectActionsMenu` — the project header overflow (`⋯`) menu. Secondary,
 * lower-frequency project actions live here so the header never grows a new
 * top-level button per capability: adding an action is one more `role="menuitem"`
 * row, not a new button. Export stays a first-class button beside this menu.
 *
 * Holds: **Activity** (opens the read-only activity overlay, when there is any
 * activity) and owner-only **Archive/Unarchive**. Renders nothing when the actor
 * can do neither.
 *
 * Built on the governed `DropdownMenu`. It used to be hand-rolled — `useState` plus a
 * `mousedown` listener plus a bare `role="menu"` div — which gave it click-outside and
 * nothing else: Escape did not close it, arrow keys did not move between items, focus
 * never returned to the trigger, and the panel could be clipped by an `overflow` ancestor
 * because it was not portalled. Radix supplies all of that.
 */
interface ProjectActionsMenuProps {
  projectId: string;
  /** Owner-only: archive/unarchive is offered only when true. */
  canArchive?: boolean;
  archived?: boolean;
  /** Activity is offered only when the project has recorded events. */
  eventCount?: number;
}

export function ProjectActionsMenu({
  projectId,
  canArchive = false,
  archived = false,
  eventCount = 0,
}: ProjectActionsMenuProps) {
  const router = useRouter();
  const optimistic = useOptimisticAction();

  const hasActivity = eventCount > 0;
  if (!hasActivity && !canArchive) return null;

  const archiveLabel = archived ? 'Unarchive project' : 'Archive project';

  function toggleArchive() {
    void optimistic.run({
      apply: () => {},
      commit: async () => {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: !archived }),
        });
        if (!res.ok) {
          throw new Error(await responseError(res, 'Could not update archive state.'));
        }
      },
      rollback: () => {},
      error: archived ? 'Could not unarchive project.' : 'Could not archive project.',
      retryable: true,
      onSettled: () => router.refresh(),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Project actions"
          className="w-8 px-0"
          data-testid="project-actions-root"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="Project actions" data-testid="project-actions-menu" className="w-48">
        {hasActivity ? (
          <DropdownMenuItem onSelect={() => automationOverlayStore.view()}>
            <ListTree />
            Activity
          </DropdownMenuItem>
        ) : null}
        {canArchive ? (
          <DropdownMenuItem
            aria-label={archiveLabel}
            disabled={optimistic.pending}
            onSelect={toggleArchive}
          >
            {archived ? <ArchiveRestore /> : <ArchiveX />}
            {archived ? 'Unarchive' : 'Archive'}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
