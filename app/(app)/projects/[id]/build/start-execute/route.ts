import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { repo } from '@/db/schema/workspace';
import { GitOps } from '@/build/branch';
import { authorizeExecute, ExecuteLockedError } from '@/build/execute-authz';
import { branchName, slugRefComponent } from '@/build/slug';

/**
 * `POST /api/.../build/start-execute` — the per-repo execute authorization +
 * (flag-gated) execute trigger (Spec 7 §Per-repo execute authorization).
 *
 * SAFETY: actually DISPATCHING execute-plan (a destructive write) is gated behind
 * `FORGE_BUILD_EXECUTE_ENABLED` which DEFAULTS OFF. With the flag off this
 * endpoint records the per-repo "Authorize execute" action_log + collision
 * precheck and returns `{ authorized:true, dispatched:false }` WITHOUT running any
 * execute-plan against a real repo. The real-dispatch drive (orchestrator) is
 * wired separately and only runs when the flag is explicitly enabled in a trusted
 * deploy.
 */
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardBuildWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  // Write-target repos for this project.
  const repos = await db
    .selectDistinct({ repoId: planTask.targetRepoId, name: repo.name })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, id));

  // F22: build-level sanitized-branch-name collision precheck BEFORE any touch.
  const collision = GitOps.collisionCheck(repos.map((r) => r.name));
  if (collision) {
    return NextResponse.json(
      { error: `branch-name collision: repos ${collision.repos.join(', ')} both sanitize to ${collision.slug}` },
      { status: 409 },
    );
  }

  // Per-repo authorize (action_log + execute.notice + advisory lock).
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

  const executeEnabled = process.env.FORGE_BUILD_EXECUTE_ENABLED === '1';
  if (!executeEnabled) {
    // Flag OFF (default): authorize only, never dispatch a real execute-plan.
    releases.forEach((rel) => rel());
    return NextResponse.json({
      authorized: true,
      dispatched: false,
      reason: 'execute disabled (FORGE_BUILD_EXECUTE_ENABLED unset)',
      branches: repos.map((r) => branchName(id, r.name)),
      slugs: repos.map((r) => slugRefComponent(r.name)),
    });
  }

  // Flag ON: the orchestrator drive is intentionally NOT inlined here — a trusted
  // deploy wires `runExecutePipeline` to a background worker that holds the locks
  // for the build's duration. Returning the authorization handle.
  releases.forEach((rel) => rel());
  return NextResponse.json({ authorized: true, dispatched: false, reason: 'execute drive runs out-of-band' });
}
