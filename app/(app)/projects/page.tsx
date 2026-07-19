import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, LayoutGrid, Clock, Sparkles, Hammer, AlertTriangle, Lightbulb } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { PageFrame, buttonVariants, Card, CardContent, EmptyState } from '@/components/ui';
import { ProjectFilterBar } from '@/components/forge/ProjectFilterBar';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import { dashboardProjects, dashboardArchivedProjects, dashboardMetrics } from '@/dashboard/dashboard-core';

const PROJECTS_NOTE = `### The pipeline

- **Explore** — describe the idea, attach context, let agents research
- **Spec** — AI-guided requirements with Q&A per section
- **Plan** — task breakdown with audit before execution
- **Execute** — agents build in isolated worktrees
- **Review** — human review of every commit
- **Journal** — capture what the team learned

### Dashboard metrics

- **Waiting for human** — a spec section or audit needs your decision
- **Agents running** — live agent work across projects`;

export default async function ProjectsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  const actor = projectActorFromMember(me);
  // A team-less member (org_admin) has no project scope; send them to their
  // org-level home rather than `/` (which would redirect back here and loop).
  if (!actor) redirect('/usage');
  const [projects, archived] = await Promise.all([
    dashboardProjects(actor),
    dashboardArchivedProjects(actor),
  ]);
  const metrics = dashboardMetrics(projects);

  const newProject = (
    <Link href="/projects/new" className={buttonVariants({ variant: 'primary' })}>
      <Plus className="size-4" />
      New project
    </Link>
  );

  const primary = (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {projects.length + archived.length > 0 ? (
          <ProjectFilterBar activeProjects={projects} archivedProjects={archived} />
        ) : (
          <EmptyState
            icon={<LayoutGrid />}
            title="No projects yet"
            description="Create your first project to start the flow — Forge takes it from idea through exploration, spec, freeze, and an autonomous build."
          />
        )}
      </CardContent>
    </Card>
  );

  // The rail note goes in StageShell's `note` slot so it sits at the TOP of the right
  // column, as on every other page. It used to trail the cards inside `navigator`, which
  // both put it at the bottom and made it the rail's last child — the slot the shell grows.
  const railNote = <RailNote icon={<Lightbulb />}>{PROJECTS_NOTE}</RailNote>;



  return (
    <PageFrame title="Projects" actions={newProject} width="full" fill>
      <StageShell
        metrics={[
          { label: 'Active', value: metrics.active, sublabel: 'In flight', icon: <LayoutGrid />, iconTint: 'accent' },
          { label: 'Waiting for human', value: metrics.awaitingHuman, muted: metrics.awaitingHuman === 0, sublabel: 'Need a decision', icon: <Clock />, iconTint: 'amber' },
          { label: 'Agents running', value: metrics.agentsRunning, muted: metrics.agentsRunning === 0, sublabel: 'Live agent work', icon: <Sparkles />, iconTint: 'sage' },
          { label: 'Build', value: metrics.inBuild, muted: metrics.inBuild === 0, sublabel: 'Shipping', icon: <Hammer />, iconTint: 'steel' },
          { label: 'Audit issues', value: metrics.auditIssues, muted: metrics.auditIssues === 0, sublabel: 'Open findings', icon: <AlertTriangle />, iconTint: 'rose' },
        ]}
        note={railNote}
      >
        {primary}
      </StageShell>
    </PageFrame>
  );
}
