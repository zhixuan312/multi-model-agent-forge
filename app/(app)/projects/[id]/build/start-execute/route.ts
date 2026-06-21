import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { repo } from '@/db/schema/workspace';
import { GitOps } from '@/build/branch';
import { authorizeExecute, ExecuteLockedError } from '@/build/execute-authz';
import { branchName } from '@/build/slug';
import { runExecutePipeline } from '@/build/orchestrator';

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

  const repos = await db
    .selectDistinct({ repoId: planTask.targetRepoId, name: repo.name })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, id));

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

  // Set target branches on plan tasks before dispatch
  for (const r of repos) {
    const tb = targetBranches[r.repoId];
    if (tb) {
      await db.update(planTask)
        .set({ targetBranch: tb })
        .where(and(eq(planTask.projectId, id), eq(planTask.targetRepoId, r.repoId)));
    }
  }

  releases.forEach((rel) => rel());

  // Dispatch in background (non-blocking 202)
  setImmediate(() => {
    void runExecutePipeline(
      { executor: {}, review: {} } as any, // deps wired at runtime by the orchestrator's defaults
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
