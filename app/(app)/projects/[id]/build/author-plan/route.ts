import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { PLAN_AUTHOR_SYSTEM_PROMPT } from '@/build/plan-author';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { planFilePath } from '@/projects/project-files';
import { getDb } from '@/db/client';
import { getLatestSpec } from '@/spec/assemble';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import '@/dispatch/handler-registry';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardBuildWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  const existing = await findInflight(db, id, 'plan-author');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const spec = await getLatestSpec(db, id);
  if (!spec) {
    return NextResponse.json({ error: 'No locked spec to plan from.' }, { status: 409 });
  }

  const [projRow] = await db
    .select({ details: project.details })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!projRow?.details) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const d = validateDetails(projRow.details);
  const repos = d.repos;

  if (repos.length === 0) {
    return NextResponse.json({ error: 'No repos in the project.' }, { status: 409 });
  }

  const repoList = repos
    .map((r) => `- id=${r.id} name=${r.name}`)
    .join('\n');

  const cwd = resolveWorkspaceRoot();
  const planPath = planFilePath(id);
  const prompt = PLAN_AUTHOR_SYSTEM_PROMPT.replace('PLAN_FILE_PATH', planPath)
    + `\n\nContext: The following specification has been locked and approved.\n\nInput:\n\n--- Locked Specification ---\n${spec.bodyMd}\n--- End Specification ---\n\n--- Repos in Scope ---\n${repoList}\n--- End Repos ---`;

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'plan-author',
    cwd,
    body: {
      prompt,
      reviewPolicy: 'none',
    },
    actorId: guard.memberId,
    meta: { actorId: guard.memberId, cwd },
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
