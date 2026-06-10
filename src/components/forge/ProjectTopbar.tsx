import Link from 'next/link';
import { Download, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Title } from '@/components/ui/typography';
import { PhaseBadge } from '@/components/forge/PhaseBadge';
import { ExportMenu } from '@/components/forge/export/ExportMenu';
import type { ProjectPhase } from '@/db/enums';

/**
 * ProjectTopbar (Spec 3 flow 3) — REAL. The locked project header lockup,
 * following the shell's left→right grammar: WAYFINDING on the left (a
 * `Projects ⁄ <name>` breadcrumb baseline-aligned with the serif title + a
 * phase status pill), ACTION on the right (presence avatars + the `Export ▾`
 * menu). The breadcrumb's `Projects` is a one-click route back to the list —
 * the wayfinding the nested project routes previously lacked. Presence avatars
 * are a static stub (live presence is Spec 5 SSE); `Export ▾` mounts the real
 * `ExportMenu` (Spec 8) when a `projectId` is present, else the inert stub.
 */
export interface ProjectTopbarPresence {
  memberId: string;
  displayName: string;
  avatarTint: string;
}

export interface ProjectTopbarProps {
  projectName?: string;
  /** The project id — mounts the real `ExportMenu` when present. */
  projectId?: string;
  /** Drives the phase kicker (`● Design`, etc.). Omitted → no kicker. */
  phase?: ProjectPhase;
  presence?: ProjectTopbarPresence[];
  /** Force the inert stub even with a projectId (no-active-project shell). */
  exportDisabled?: boolean;
}

export function ProjectTopbar({
  projectName,
  projectId,
  phase,
  presence = [],
  exportDisabled = false,
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

        {projectId && !exportDisabled ? (
          <ExportMenu projectId={projectId} />
        ) : (
          <Button variant="secondary" size="sm" disabled leftIcon={<Download />} rightIcon={<ChevronDown />}>
            Export
          </Button>
        )}
      </div>
    </div>
  );
}
