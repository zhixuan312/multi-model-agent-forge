import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { repo } from '@/db/schema/workspace';
import { buildMmaClient } from '@/mma/server-client';
import { runPlanAuditPass, MAX_PLAN_AUDIT_PASSES } from '@/build/audit-plan-loop';
import { planFilePath } from '@/build/plan-fs';

/**
 * `POST /api/.../build/run-audit` — run ONE plan-audit pass per write-target repo
 * (Spec 7 §Audit loop). Read-only: `audit(subtype='plan')` against each repo's
 * plan file. The full revise-loop (re-author on blocking findings) is driven by
 * the orchestrator; this endpoint exposes one round for the gated UI.
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
  const mma = await buildMmaClient({ db });

  // One plan file per write-target repo.
  const rows = await db
    .selectDistinct({ repoId: planTask.targetRepoId, name: repo.name, path: repo.pathOnDisk })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, id));

  const passes = [];
  for (const r of rows) {
    const res = await runPlanAuditPass(
      { db, mma },
      {
        projectId: id,
        repoName: r.name,
        repoCwd: r.path,
        planFilePath: planFilePath(r.path, id),
        actorId: guard.memberId,
      },
    );
    passes.push({ repo: r.name, ...res });
  }
  return NextResponse.json({ passes, maxPasses: MAX_PLAN_AUDIT_PASSES });
}
