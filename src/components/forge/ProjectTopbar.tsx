'use client';

// A client component: it uses showToast and passes an onToast handler to ExportMenu (a client
// component). A server component may NOT pass function props to a client child — that threw
// "Event handlers cannot be passed to Client Component props". All props from the layout are
// serializable, so promoting this to a client component is safe.
import Link from 'next/link';
import { Title } from '@/components/ui/typography';
import { PhaseBadge } from '@/components/forge/PhaseBadge';
import { ExportMenu } from '@/components/forge/export/ExportMenu';
import { showToast } from '@/components/ui/toast';
import { ProjectActionsMenu } from '@/components/forge/ProjectActionsMenu';
import type { ProjectPhase } from '@/db/enums';

/**
 * The project header. ONE caller — `app/(app)/projects/[id]/layout.tsx` — which always has a
 * project, so the props it needs are required rather than optional-with-a-fallback.
 *
 * Four things were removed because nothing could reach them:
 *   - `presence` (an avatar row of who else is viewing) had no data source anywhere in the
 *     app — no table, no route, no caller. It rendered an empty flex box on every project.
 *   - `exportDisabled` was never passed, so the disabled-Export fallback beside it was
 *     unreachable; Export is offered whenever there is a project, which is always.
 *   - `projectName`/`projectId` optional, and with them the "No active project" placeholder
 *     and the two `projectId ? … : null` guards.
 *
 * The component TEST kept them alive by rendering `<ProjectTopbar />` bare — a state the app
 * cannot produce. A test is not a caller.
 */
export interface ProjectTopbarProps {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  eventCount?: number;
  canArchive?: boolean;
  archived?: boolean;
}

export function ProjectTopbar({
  projectId,
  projectName,
  phase,
  eventCount = 0,
  canArchive = false,
  archived = false,
}: ProjectTopbarProps) {
  return (
    <div data-testid="project-topbar" className="flex w-full items-center gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <Link
            href="/projects"
            className="t-micro shrink-0 rounded-sm text-ink-faint transition-colors duration-150 ease-[var(--ease-out)] hover:text-ink focus-ring"
          >
            Projects
          </Link>
          <span aria-hidden className="t-micro shrink-0 text-ink-faint/60">
            ⁄
          </span>
          <Title className="min-w-0 truncate !text-lg !leading-tight">{projectName}</Title>
        </div>
        <PhaseBadge phase={phase} className="shrink-0" />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <ProjectActionsMenu
          projectId={projectId}
          canArchive={canArchive}
          archived={archived}
          eventCount={eventCount}
        />
        <ExportMenu projectId={projectId} onToast={(message) => showToast({ type: 'success', message })} />
      </div>
    </div>
  );
}
