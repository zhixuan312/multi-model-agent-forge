import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, LayoutGrid, Clock, Sparkles, Hammer, AlertTriangle, CircleAlert, Loader2, Lightbulb } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { projectActorFromMember } from '@/auth/team-scope';
import { PageFrame, buttonVariants, Card, CardContent, TextStrong, EmptyState } from '@/components/ui';
import { ProjectFilterBar } from '@/components/forge/ProjectFilterBar';
import { RailCard, RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { dashboardProjects, dashboardMetrics, type DashboardProject } from '@/dashboard/dashboard-core';

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

function attentionReason(p: DashboardProject): string {
  if (p.awaitingHuman > 0) {
    return `${p.awaitingHuman} spec section${p.awaitingHuman === 1 ? '' : 's'} await your review`;
  }
  return `spec audit has ${p.openAuditIssues} open finding${p.openAuditIssues === 1 ? '' : 's'}`;
}

export default async function ProjectsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  const actor = projectActorFromMember(me);
  // A team-less member (org_admin) has no project scope; send them to their
  // org-level home rather than `/` (which would redirect back here and loop).
  if (!actor) redirect('/usage');
  const projects = await dashboardProjects(actor);
  const metrics = dashboardMetrics(projects);

  const attention = projects.filter((p) => p.awaitingHuman > 0 || p.openAuditIssues > 0);
  const running = projects.filter((p) => p.agentsRunning > 0);
  const totalAgents = running.reduce((s, p) => s + p.agentsRunning, 0);

  const newProject = (
    <Link href="/projects/new" className={buttonVariants({ variant: 'primary' })}>
      <Plus className="size-4" />
      New project
    </Link>
  );

  const primary = (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {projects.length > 0 ? (
          <ProjectFilterBar projects={projects} />
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

  const aside = (
    <>
      {attention.length > 0 ? (
        <RailCard title="Needs your attention" badge={attention.length}>
          <ul className="flex flex-col">
            {attention.map((p) => (
              <li key={p.id}>
                <a
                  href={`/projects/${p.id}`}
                  className="focus-ring flex gap-2.5 border-t border-line py-2.5 text-sm leading-snug text-ink-soft transition-colors first:border-t-0 first:pt-0 hover:text-ink"
                >
                  <CircleAlert className="mt-px size-[15px] shrink-0 text-amber" aria-hidden />
                  <span className="min-w-0">
                    <TextStrong as="span" className="!text-ink">{p.name}</TextStrong> — {attentionReason(p)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </RailCard>
      ) : null}
      {totalAgents > 0 ? (
        <RailCard title="Agent activity">
          <div className="flex items-center gap-2.5 text-sm text-ink-soft">
            <Loader2 className="size-[15px] shrink-0 animate-spin text-amber" aria-hidden />
            <span><TextStrong as="span" className="!text-ink">{totalAgents}</TextStrong> agent{totalAgents === 1 ? '' : 's'} running</span>
          </div>
        </RailCard>
      ) : null}
      <RailNote icon={<Lightbulb />}>{PROJECTS_NOTE}</RailNote>
    </>
  );

  return (
    <PageFrame title="Projects" actions={newProject} width="full" fill>
      <StatusDashboard
        metrics={[
          { label: 'Active', value: metrics.active, sublabel: 'In flight', icon: <LayoutGrid />, iconTint: 'accent' },
          { label: 'Waiting for human', value: metrics.awaitingHuman, muted: metrics.awaitingHuman === 0, sublabel: 'Need a decision', icon: <Clock />, iconTint: 'amber' },
          { label: 'Agents running', value: metrics.agentsRunning, muted: metrics.agentsRunning === 0, sublabel: 'Live agent work', icon: <Sparkles />, iconTint: 'sage' },
          { label: 'Build', value: metrics.inBuild, muted: metrics.inBuild === 0, sublabel: 'Shipping', icon: <Hammer />, iconTint: 'steel' },
          { label: 'Audit issues', value: metrics.auditIssues, muted: metrics.auditIssues === 0, sublabel: 'Open findings', icon: <AlertTriangle />, iconTint: 'rose' },
        ]}
        primary={primary}
        aside={aside}
      />
    </PageFrame>
  );
}
