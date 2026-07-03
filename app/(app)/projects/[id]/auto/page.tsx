import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { AutomationDashboard } from '@/components/forge/AutomationDashboard';
import { loadProjectSummary } from '@/projects/project-summary';

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const db = getDb();
  const [proj] = await db
    .select({
      name: project.name,
      autoMode: project.autoMode,
      autoNote: project.autoNote,
      currentStage: project.currentStage,
      phase: project.phase,
      completedAt: project.completedAt,
    })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);

  if (!proj) notFound();

  // If not in auto mode, redirect to the project landing
  if (!proj.autoMode && !proj.completedAt) {
    redirect(`/projects/${id}`);
  }

  const summary = await loadProjectSummary(db, id);

  return (
    <AutomationDashboard
      projectId={id}
      projectName={proj.name}
      autoMode={proj.autoMode}
      autoNote={proj.autoNote ?? ''}
      currentStage={proj.currentStage ?? 'spec'}
      phase={proj.phase}
      summary={summary}
    />
  );
}
