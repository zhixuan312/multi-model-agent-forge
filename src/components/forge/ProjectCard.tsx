import Link from 'next/link';
import { Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, Badge, Avatar, Title, Text, Mono } from '@/components/ui';
import { PhaseBadge } from '@/components/forge/PhaseBadge';
import { formatRelative } from '@/lib/format-relative';
import type { ProjectListItem } from '@/projects/projects-core';
import type { StageStatus } from '@/db/enums';

/**
 * ProjectCard (Spec 3 flow 2) — serif title · phase badge · summary (or neutral
 * placeholder) · 5-segment stage rail · footer (owner avatar+name · visibility
 * chip · N repos · relative updated_at). The whole card links to the project.
 *
 * The phase pill is the shared `PhaseBadge` — the card and the project header
 * speak the same status language (same labels, same lifecycle colours). The
 * stage rail is CSS-theme-driven (colour swaps with `data-phase`), so colour
 * is NOT the testable channel — each segment carries an `aria-label` text
 * alternative (done/active/pending) so screen-reader users get the status.
 */

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
  return (
    <Link href={`/projects/${project.id}`} data-testid={`project-card-${project.id}`} className="block">
      <Card interactive elevation="flat" className="h-full">
        <CardContent className="flex flex-col gap-3 py-5">
          <div className="flex items-start justify-between gap-3">
            <Title as="h2" className="!text-xl leading-tight">
              {project.name}
            </Title>
            <PhaseBadge phase={project.phase} size="md" className="shrink-0" />
          </div>

          <Text className="min-h-[2.4em] !text-sm">
            {project.summary ?? (
              <span className="italic text-ink-faint">No summary yet — set during Spec.</span>
            )}
          </Text>

          <StageRail stages={project.stages} />

          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <Avatar size="sm" name={project.ownerDisplayName} tint={project.ownerAvatarTint} aria-hidden />
              <span className="truncate text-ink-soft">{project.ownerDisplayName}</span>
              <span aria-hidden="true" className="text-line-strong">
                ·
              </span>
              <Badge data-testid="visibility-chip" size="sm" icon={project.visibility === 'private' ? <Lock /> : <Globe />}>
                {project.visibility}
              </Badge>
              {project.unavailableRepoCount > 0 ? (
                <Badge data-testid="repo-unavailable-chip" variant="rose" size="sm">
                  repo unavailable
                </Badge>
              ) : null}
            </div>
            <Mono className="!text-[11px] text-ink-faint">
              {project.repoCount} repos · {formatRelative(project.updatedAt)}
            </Mono>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
