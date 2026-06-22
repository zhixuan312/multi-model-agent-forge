import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { PLAN_AUTHOR_SYSTEM_PROMPT } from '@/build/plan-author';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { getDb } from '@/db/client';
import { getLatestSpec } from '@/spec/assemble';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
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

  const repos = await db
    .select({ id: repo.id, name: repo.name, tags: repo.tags })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, id));

  if (repos.length === 0) {
    return NextResponse.json({ error: 'No repos in the project.' }, { status: 409 });
  }

  const repoList = repos
    .map((r) => `- id=${r.id} name=${r.name} tags=${r.tags.join(',') || '—'}`)
    .join('\n');

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'plan-author',
    cwd: resolveWorkspaceRoot(),
    body: {
      prompt: `${PLAN_AUTHOR_SYSTEM_PROMPT}\n\nLocked spec:\n\n${spec.bodyMd}\n\nRepos in scope:\n${repoList}`,
      actorId: guard.memberId,
    },
    actorId: guard.memberId,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
