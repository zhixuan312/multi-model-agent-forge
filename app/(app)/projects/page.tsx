import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, LayoutGrid, Clock, Sparkles, Hammer, AlertTriangle } from 'lucide-react';
import { currentMember } from '@/auth/current-member';
import { PageFrame, buttonVariants, MetricCard, Card, CardContent } from '@/components/ui';
import { ProjectFilterBar } from '@/components/forge/ProjectFilterBar';
import { ProjectsRail } from '@/components/forge/ProjectsRail';
import { dashboardProjects, dashboardMetrics } from '@/dashboard/dashboard-core';

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
    <PageFrame title="Projects" actions={newProject} width="full" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* STATUS — five flow-health metrics */}
        <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Active" value={metrics.active} sublabel="In flight" icon={<LayoutGrid />} iconTint="accent" />
          <MetricCard label="Waiting for human" value={metrics.awaitingHuman} muted={metrics.awaitingHuman === 0} sublabel="Need a decision" icon={<Clock />} iconTint="amber" />
          <MetricCard label="Agents running" value={metrics.agentsRunning} muted={metrics.agentsRunning === 0} sublabel="Live agent work" icon={<Sparkles />} iconTint="sage" />
          <MetricCard label="Frozen / Build" value={metrics.frozenBuild} muted={metrics.frozenBuild === 0} sublabel="Shipping" icon={<Hammer />} iconTint="steel" />
          <MetricCard label="Audit issues" value={metrics.auditIssues} muted={metrics.auditIssues === 0} sublabel="Open findings" icon={<AlertTriangle />} iconTint="rose" />
        </div>

        {/* PRIMARY work-queue (2/3) ∣ RAIL (1/3), fills to the page bottom */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <Card className="flex min-h-0 flex-col lg:col-span-2">
            <CardContent className="flex min-h-0 flex-1 flex-col">
              {projects.length > 0 ? (
                <ProjectFilterBar projects={projects} />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                  <span className="grid size-10 place-items-center rounded-full bg-accent-tint text-accent">
                    <LayoutGrid className="size-5" />
                  </span>
                  <p className="text-sm font-medium text-ink">No projects yet</p>
                  <p className="max-w-xs text-xs leading-relaxed text-ink-soft">
                    Create your first project to start the flow — Forge takes it from idea through exploration, spec, freeze, and an autonomous build.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            <ProjectsRail projects={projects} />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
