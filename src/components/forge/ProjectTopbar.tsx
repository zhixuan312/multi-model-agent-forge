import { cn } from '@/lib/cn';
import { initials } from '@/components/forge/avatar';

/**
 * ProjectTopbar — static placeholder in Spec 1 (props contract F34). Presence
 * avatars + an inert `Export ▾` slot; no project drives it until Spec 3. In
 * Spec 1 it renders with `projectName` undefined, `presence: []`, and Export
 * disabled.
 */
export interface ProjectTopbarPresence {
  memberId: string;
  displayName: string;
  avatarTint: string;
}

export interface ProjectTopbarProps {
  projectName?: string;
  presence?: ProjectTopbarPresence[];
  /** True in Spec 1 — the Export slot is inert until Spec 8. */
  exportDisabled?: boolean;
}

export function ProjectTopbar({
  projectName,
  presence = [],
  exportDisabled = true,
}: ProjectTopbarProps) {
  return (
    <div
      data-testid="project-topbar"
      className="flex items-center justify-between gap-3"
    >
      <div className="font-serif text-base font-semibold text-ink">
        {projectName ?? <span className="text-ink-faint italic">No active project</span>}
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

        <button
          type="button"
          disabled={exportDisabled}
          aria-disabled={exportDisabled}
          className={cn(
            'rounded-[var(--r)] border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink',
            exportDisabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span aria-hidden="true">⭳ </span>Export <span aria-hidden="true">▾</span>
        </button>
      </div>
    </div>
  );
}
