import Link from 'next/link';
import { Globe, Lock, GitBranch } from 'lucide-react';
import {
  Card,
  CardContent,
  Badge,
  Title,
  Text,
  Mono,
  StageRail,
  NextActionPill,
  AvatarGroup,
} from '@/components/ui';
import { PhaseBadge } from '@/components/forge/PhaseBadge';
import { formatRelative } from '@/lib/format-relative';
import type { DashboardProject } from '@/dashboard/dashboard-core';
import type { ArtifactKind } from '@/db/enums';

/**
 * ProjectCard — the Primary-section work-queue card (Spec 3 flow 2, control
 * tower). Leads with the derived NEXT ACTION (what to do), shows flow position
 * via the StageRail, and keeps everything else muted. Built entirely from
 * palette components — PhaseBadge · StageRail · NextActionPill · AvatarGroup —
 * over real `DashboardProject` data. The whole card links to the project.
 */
const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  exploration_brief: 'Brief',
  exploration: 'Exploration',
  spec: 'Spec',
  plan: 'Plan',
};

export function ProjectCard({ project }: { project: DashboardProject }) {
  const members = [
    { name: project.ownerDisplayName, tint: project.ownerAvatarTint },
    ...project.collaborators.map((c) => ({ name: c.displayName, tint: c.avatarTint })),
  ];

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
              <span className="italic text-ink-faint">No summary yet — set from the brief.</span>
            )}
          </Text>

          <div className="flex items-center gap-2.5">
            <StageRail
              className="flex-1"
              segments={project.stages.map((s) => ({ status: s.status, label: s.kind }))}
            />
            {project.latestArtifact ? (
              <Mono className="!text-[11px] shrink-0 text-ink-faint">
                {ARTIFACT_LABEL[project.latestArtifact.kind]} v{project.latestArtifact.version}
              </Mono>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <NextActionPill tone={project.nextAction.tone}>{project.nextAction.label}</NextActionPill>
            <div className="ml-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-soft">
              <AvatarGroup members={members} max={3} />
              <span className="truncate">{project.ownerDisplayName}</span>
              <span data-testid="visibility-chip" className="inline-flex items-center gap-1">
                {project.visibility === 'private' ? (
                  <Lock className="size-3" aria-hidden />
                ) : (
                  <Globe className="size-3" aria-hidden />
                )}
                {project.visibility}
              </span>
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3" aria-hidden />
                {project.repoCount} repo{project.repoCount === 1 ? '' : 's'}
              </span>
              {project.unavailableRepoCount > 0 ? (
                <Badge data-testid="repo-unavailable-chip" variant="rose" size="sm">
                  repo unavailable
                </Badge>
              ) : null}
              <Mono className="!text-[11px] text-ink-faint">{formatRelative(project.updatedAt)}</Mono>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
