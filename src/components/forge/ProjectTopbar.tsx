import { cn } from '@/lib/cn';
import { initials } from '@/components/forge/avatar';
import { ExportMenu } from '@/components/forge/export/ExportMenu';
import type { ProjectPhase } from '@/db/enums';

/**
 * ProjectTopbar (Spec 3 flow 3) — REAL. The phase kicker reflects `project.phase`;
 * presence avatars are a static stub (live presence is Spec 5 SSE). The `Export ▾`
 * slot mounts the real `ExportMenu` (Spec 8) when a `projectId` is provided;
 * otherwise it falls back to the inert disabled stub.
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
    <div data-testid="project-topbar" className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        {phase ? (
          <span
            data-testid="phase-kicker"
            className="text-[9px] font-bold uppercase tracking-wider text-accent"
          >
            <span aria-hidden="true">● </span>
            {PHASE_LABEL[phase]}
          </span>
        ) : null}
        <div className="font-serif text-base font-semibold text-ink">
          {projectName ?? <span className="text-ink-faint italic">No active project</span>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div data-testid="presence" className="flex">
          {presence.map((p, i) => (
            <span
              key={p.memberId}
              title={p.displayName}
              style={{ background: p.avatarTint, marginLeft: i === 0 ? 0 : -7 }}
              className="grid h-6 w-6 place-items-center rounded-full border-2 border-surface text-[9px] font-medium text-white"
            >
              {initials(p.displayName)}
            </span>
          ))}
        </div>

        {projectId && !exportDisabled ? (
          <ExportMenu projectId={projectId} />
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className={cn(
              'rounded-[var(--r)] border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink',
              'cursor-not-allowed opacity-60',
            )}
          >
            <span aria-hidden="true">⭳ </span>Export <span aria-hidden="true">▾</span>
          </button>
        )}
      </div>
    </div>
  );
}
