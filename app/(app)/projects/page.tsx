import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, LayoutGrid, Clock, Sparkles, Hammer, AlertTriangle } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import {
  PageFrame,
  buttonVariants,
  MetricRow,
  MetricCard,
  Split,
  EmptyState,
} from '@/components/ui';
import { ProjectFilterBar } from '@/components/forge/ProjectFilterBar';
import { ProjectsRail } from '@/components/forge/ProjectsRail';
import { dashboardProjects, dashboardMetrics } from '@/dashboard/dashboard-core';

/**
 * Projects — the control tower (Spec 3 flow 2). RSC loads the enriched dashboard
 * set (`dashboardProjects`: gate/activity/artifact signals + derived next action,
 * one bounded query per signal). The five flow-health metrics reduce from it; the
 * page composes the content frame: STATUS (metrics) → CONTROLS+PRIMARY (filter +
 * work-queue) → RAIL (attention · activity · guidance). Empty product → one
 * purposeful EmptyState, never a blank frame.
 */
export default async function ProjectsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  const projects = await dashboardProjects({ id: me.id });
  const metrics = dashboardMetrics(projects);

  const newProject = (
    <Link href="/projects/new" className={buttonVariants({ variant: 'primary' })}>
      <Plus className="size-4" />
      New project
    </Link>
  );

  return (
    <PageFrame
      title="Projects"
      description="Move work from idea → spec → frozen build, with MMA agents doing the work underneath."
      actions={newProject}
      width="wide"
    >
      {projects.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title="No projects yet"
          description="Create your first project to start the flow — Forge takes it from idea through exploration, spec, freeze, and an autonomous build."
          action={newProject}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <MetricRow>
            <MetricCard label="Active" value={metrics.active} icon={<LayoutGrid />} />
            <MetricCard
              label="Waiting for human"
              value={metrics.awaitingHuman}
              tone={metrics.awaitingHuman > 0 ? 'attention' : 'neutral'}
              muted={metrics.awaitingHuman === 0}
              icon={<Clock />}
            />
            <MetricCard label="Agents running" value={metrics.agentsRunning} muted={metrics.agentsRunning === 0} icon={<Sparkles />} />
            <MetricCard label="Frozen / Build" value={metrics.frozenBuild} muted={metrics.frozenBuild === 0} icon={<Hammer />} />
            <MetricCard label="Audit issues" value={metrics.auditIssues} muted={metrics.auditIssues === 0} icon={<AlertTriangle />} />
          </MetricRow>

          <Split aside={<ProjectsRail projects={projects} />} asideWidth="320px">
            <ProjectFilterBar projects={projects} />
          </Split>
        </div>
      )}
    </PageFrame>
  );
}
