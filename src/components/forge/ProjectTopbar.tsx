'use client';

// A client component: it uses showToast and passes an onToast handler to ExportMenu (a client
// component). A server component may NOT pass function props to a client child — that threw
// "Event handlers cannot be passed to Client Component props". All props from the layout are
// serializable, so promoting this to a client component is safe.
import Link from 'next/link';
import { Download, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Title } from '@/components/ui/typography';
import { PhaseBadge } from '@/components/forge/PhaseBadge';
import { ExportMenu } from '@/components/forge/export/ExportMenu';
import { showToast } from '@/components/ui/toast';
import { ProjectActionsMenu } from '@/components/forge/ProjectActionsMenu';
import type { ProjectPhase } from '@/db/enums';

export interface ProjectTopbarPresence {
  memberId: string;
  displayName: string;
  avatarTint: string;
}

export interface ProjectTopbarProps {
  projectName?: string;
  projectId?: string;
  phase?: ProjectPhase;
  presence?: ProjectTopbarPresence[];
  exportDisabled?: boolean;
  eventCount?: number;
  canArchive?: boolean;
  archived?: boolean;
}

export function ProjectTopbar({
  projectName,
  projectId,
  phase,
  presence = [],
  exportDisabled = false,
  eventCount = 0,
  canArchive = false,
  archived = false,
}: ProjectTopbarProps) {
  return (
    <div data-testid="project-topbar" className="flex w-full items-center gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          {projectName ? (
            <>
              <Link
                href="/projects"
                className="t-micro shrink-0 rounded-sm text-ink-faint transition-colors duration-150 ease-[var(--ease-out)] hover:text-ink focus-ring"
              >
                Projects
              </Link>
              <span aria-hidden className="t-micro shrink-0 text-ink-faint/60">
                ⁄
              </span>
            </>
          ) : null}
          <Title className="min-w-0 truncate !text-lg !leading-tight">
            {projectName ?? <span className="italic text-ink-faint">No active project</span>}
          </Title>
        </div>
        {phase ? <PhaseBadge phase={phase} className="shrink-0" /> : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div data-testid="presence" className="flex">
          {presence.map((p, i) => (
            <Avatar
              key={p.memberId}
              size="sm"
              name={p.displayName}
              tint={p.avatarTint}
              title={p.displayName}
              className="ring-2 ring-surface"
              style={{ marginLeft: i === 0 ? 0 : -7 }}
            />
          ))}
        </div>

        {projectId ? (
          <ProjectActionsMenu
            projectId={projectId}
            canArchive={canArchive}
            archived={archived}
            eventCount={eventCount}
          />
        ) : null}

        {projectId && !exportDisabled ? (
          <ExportMenu projectId={projectId} onToast={(message) => showToast({ type: 'success', message })} />
        ) : (
          <Button variant="secondary" size="sm" disabled leftIcon={<Download />} rightIcon={<ChevronDown />}>
            Export
          </Button>
        )}
      </div>
    </div>
  );
}
