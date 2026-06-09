import Link from 'next/link';
import { cn } from '@/lib/cn';
import { initials } from '@/components/forge/avatar';
import { formatRelative } from '@/lib/format-relative';
import type { ProjectListItem } from '@/projects/projects-core';
import type { ProjectPhase, StageStatus } from '@/db/enums';

/**
 * ProjectCard (Spec 3 flow 2) — serif title · phase badge · summary (or neutral
 * placeholder) · 5-segment stage rail · footer (owner avatar+name · visibility
 * chip · N repos · relative updated_at). The whole card links to the project.
 *
 * The stage rail is CSS-theme-driven (colour swaps with `data-phase`), so colour
 * is NOT the testable channel — each segment carries an `aria-label` text
 * alternative (done/active/pending) so screen-reader users get the status.
 */

const PHASE_BADGE: Record<ProjectPhase, { label: string; cls: string }> = {
  design: { label: 'Design', cls: 'bg-accent-tint text-accent-deep' },
  frozen: { label: 'Frozen', cls: 'bg-accent-tint text-accent-deep' },
  build: { label: 'Build', cls: 'bg-accent-tint text-accent-deep' },
  done: { label: 'Done', cls: 'bg-sage-tint text-sage-deep' },
};

const RAIL_CLASS: Record<StageStatus, string> = {
  done: 'bg-[var(--rail-done,var(--sage))]',
  active: 'bg-[var(--rail-active,var(--accent))]',
  pending: 'bg-[var(--rail-pending,var(--line-strong))]',
};

function StageRail({ stages }: { stages: { kind: string; status: StageStatus }[] }) {
  return (
    <ul aria-label="Stage progress" className="flex list-none gap-1 p-0">
      {stages.map((s) => (
        <li
          key={s.kind}
          data-stage={s.kind}
          data-status={s.status}
          aria-label={`${s.kind}: ${s.status}`}
          className={cn('h-1 flex-1 rounded', RAIL_CLASS[s.status])}
        />
      ))}
    </ul>
  );
}

export function ProjectCard({ project }: { project: ProjectListItem }) {
  const badge = PHASE_BADGE[project.phase];
  return (
    <Link
      href={`/projects/${project.id}`}
      data-testid={`project-card-${project.id}`}
      className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-line bg-surface p-5 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold leading-tight text-ink">{project.name}</h2>
        <span
          data-testid="phase-badge"
          className={cn(
            'whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold',
            badge.cls,
          )}
        >
          <span aria-hidden="true">● </span>
          {badge.label}
        </span>
      </div>

      <p className="min-h-[2.4em] text-sm leading-relaxed text-ink-soft">
        {project.summary ?? (
          <span className="italic text-ink-faint">No summary yet — set during Spec.</span>
        )}
      </p>

      <StageRail stages={project.stages} />

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            style={{ background: project.ownerAvatarTint }}
            className="grid h-[22px] w-[22px] place-items-center rounded-full text-[9px] font-semibold text-white"
          >
            {initials(project.ownerDisplayName)}
          </span>
          <span className="text-ink-soft">{project.ownerDisplayName}</span>
          <span aria-hidden="true" className="text-line-strong">·</span>
          <span
            data-testid="visibility-chip"
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft"
          >
            <span aria-hidden="true">{project.visibility === 'private' ? '🔒' : '⊕'}</span>
            {project.visibility}
          </span>
          {project.unavailableRepoCount > 0 ? (
            <span
              data-testid="repo-unavailable-chip"
              className="inline-flex items-center gap-1 rounded-full border border-rose/40 bg-rose/10 px-2 py-0.5 text-[11px] text-rose"
            >
              repo unavailable
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[11px] text-ink-faint">
          {project.repoCount} repos · {formatRelative(project.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
