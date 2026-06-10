import { Download, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Title, Eyebrow } from '@/components/ui/typography';
import { ExportMenu } from '@/components/forge/export/ExportMenu';
import type { ProjectPhase } from '@/db/enums';

/**
 * ProjectTopbar (Spec 3 flow 3) — REAL. Renders into the LOCKED `ShellHeader`
 * bar (the header owns the border / background / height / padding), so this is a
 * clean full-width single row: a phase eyebrow + serif project name on the left,
 * presence avatars + the `Export ▾` menu on the right. The phase kicker reflects
 * `project.phase`; presence avatars are a static stub (live presence is Spec 5
 * SSE). The `Export ▾` slot mounts the real `ExportMenu` (Spec 8) when a
 * `projectId` is provided; otherwise it falls back to the inert disabled stub.
 */
export interface ProjectTopbarPresence {
  memberId: string;
  displayName: string;
  avatarTint: string;
}

const PHASE_LABEL: Record<ProjectPhase, string> = {
  design: 'Design',
  frozen: 'Frozen',
  build: 'Build',
  done: 'Done',
};

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
      <div className="flex min-w-0 flex-col">
        {phase ? (
          <Eyebrow data-testid="phase-kicker" className="!text-accent">
            <span aria-hidden="true">● </span>
            {PHASE_LABEL[phase]}
          </Eyebrow>
        ) : null}
        <Title className="min-w-0 truncate !text-lg !leading-tight">
          {projectName ?? <span className="italic text-ink-faint">No active project</span>}
        </Title>
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
