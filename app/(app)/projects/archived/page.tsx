import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArchiveRestore, FolderArchive } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { archivedProjects } from '@/projects/projects-core';
import { PageFrame, Card, CardContent, EmptyState, Mono, Text, Title } from '@/components/ui';
import { PhaseBadge } from '@/components/forge/PhaseBadge';
import { ProjectArchiveButton } from '@/components/forge/ProjectArchiveButton';
import { formatRelative } from '@/lib/format-relative';

export default async function ArchivedProjectsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  const actor = projectActorFromMember(me);
  if (!actor) redirect('/usage');

  const projects = await archivedProjects(actor);

  return (
    <PageFrame title="Archived" width="full">
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderArchive />}
          title="No archived projects"
          description="Archived projects you restore will return to the active Projects list."
        />
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardContent className="flex flex-col gap-3 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/projects/${project.id}`} className="focus-ring rounded-sm">
                      <Title as="h2" className="!text-xl leading-tight">
                        {project.name}
                      </Title>
                    </Link>
                    <Text className="mt-1 !text-sm text-ink-soft">
                      {project.summary ?? 'No summary yet.'}
                    </Text>
                  </div>
                  <div className="flex items-center gap-2">
                    <PhaseBadge phase={project.phase} size="md" />
                    {project.ownerId === actor.id && (
                      <ProjectArchiveButton projectId={project.id} archived />
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                  <span className="inline-flex items-center gap-1">
                    <ArchiveRestore className="size-3" aria-hidden />
                    Archived {formatRelative(project.archivedAt)}
                  </span>
                  <span>{project.ownerDisplayName}</span>
                  <span>{project.repoCount} repo{project.repoCount === 1 ? '' : 's'}</span>
                  <Mono className="!text-[11px] text-ink-faint">{formatRelative(project.updatedAt)}</Mono>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageFrame>
  );
}
