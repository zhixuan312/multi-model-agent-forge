'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, ListTree, ArchiveX, ArchiveRestore } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { automationOverlayStore } from '@/components/forge/AutomationGate';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';

/**
 * `ProjectActionsMenu` — the project header overflow (`⋯`) menu. Secondary,
 * lower-frequency project actions live here so the header never grows a new
 * top-level button per capability: adding an action is one more `role="menuitem"`
 * row, not a new button. Export stays a first-class button beside this menu.
 *
 * Holds: **Activity** (opens the read-only activity overlay, when there is any
 * activity) and owner-only **Archive/Unarchive**. Renders nothing when the actor
 * can do neither. Hand-rolled (useState + click-outside + `role="menu"`) to match
 * the sibling `ExportMenu` and stay trivially testable.
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
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const optimistic = useOptimisticAction();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

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
          const body = await res.json().catch(() => ({ error: 'Could not update archive state.' }));
          throw new Error(body.error ?? 'Could not update archive state.');
        }
      },
      rollback: () => {},
      error: archived ? 'Could not unarchive project.' : 'Could not archive project.',
      retryable: true,
      onSettled: () => router.refresh(),
    });
  }

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-left text-sm text-ink-soft transition-colors hover:bg-bg-sunk hover:text-ink disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-ink-faint';

  return (
    <div ref={ref} className="relative" data-testid="project-actions-root">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project actions"
        className="w-8 px-0"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal />
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label="Project actions"
          data-testid="project-actions-menu"
          className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface p-1.5 shadow-xl"
        >
          {hasActivity ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                automationOverlayStore.view();
              }}
            >
              <ListTree />
              Activity
            </button>
          ) : null}
          {canArchive ? (
            <button
              type="button"
              role="menuitem"
              aria-label={archiveLabel}
              disabled={optimistic.pending}
              className={cn(itemClass)}
              onClick={() => {
                setOpen(false);
                toggleArchive();
              }}
            >
              {archived ? <ArchiveRestore /> : <ArchiveX />}
              {archived ? 'Unarchive' : 'Archive'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
