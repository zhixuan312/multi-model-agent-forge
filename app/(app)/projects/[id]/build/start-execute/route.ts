import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { GitOps } from '@/build/branch';
import { authorizeExecute, ExecuteLockedError } from '@/build/execute-authz';
import { branchName } from '@/build/slug';
import { runExecutePipeline } from '@/build/orchestrator';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardBuildWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  const body = await req.json().catch(() => ({})) as { targetBranches?: Record<string, string> };
  const targetBranches: Record<string, string> = body.targetBranches ?? {};

  // Read repos from details
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!projRow?.details) return NextResponse.json({ error: 'No project details' }, { status: 400 });
  const d = validateDetails(projRow.details);

  const tasks = d.stages.plan.phases.refine.tasks;
  const repoIds = [...new Set(tasks.map((t) => t.targetRepoId).filter(Boolean) as string[])];
  if (repoIds.length === 0 && d.repos.length > 0) {
    repoIds.push(...d.repos.map((r) => r.id));
  }

  const repoRows = repoIds.length > 0
    ? await db.select({ id: repo.id, name: repo.name }).from(repo).where(eq(repo.id, repoIds[0]!))
    : [];
  const repos = repoRows.map((r) => ({ repoId: r.id, name: r.name }));

  if (repos.length === 0) {
    return NextResponse.json({ error: 'no write-target repos with queued tasks' }, { status: 400 });
  }

  const collision = GitOps.collisionCheck(repos.map((r) => r.name));
  if (collision) {
    return NextResponse.json(
      { error: `branch-name collision: repos ${collision.repos.join(', ')} both sanitize to ${collision.slug}` },
      { status: 409 },
    );
  }

  const releases: Array<() => void> = [];
  try {
    for (const r of repos) {
      const release = await authorizeExecute(
        { projectId: id, repoId: r.repoId, repoName: r.name, memberId: guard.memberId },
        { db },
      );
      releases.push(release);
    }
  } catch (e) {
    releases.forEach((rel) => rel());
    if (e instanceof ExecuteLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  // Set target branches on tasks in details
  for (const r of repos) {
    const tb = targetBranches[r.repoId];
    if (tb) {
      await updateDetails(db, id, (det) => {
        for (const t of det.stages.plan.phases.refine.tasks) {
          if (t.targetRepoId === r.repoId) {
            t.targetBranch = tb;
          }
        }
        return det;
      });
    }
  }

  releases.forEach((rel) => rel());

  // Dispatch in background (non-blocking 202)
  setImmediate(() => {
    void runExecutePipeline(
      { executor: {}, review: {} } as any,
      { projectId: id, actorId: guard.memberId, targetBranches },
    ).catch((err) => {
      console.error('[forge] build pipeline crashed', err);
    });
  });

  return NextResponse.json(
    { authorized: true, dispatched: true, branches: repos.map((r) => branchName(id, r.name)) },
    { status: 202 },
  );
}
