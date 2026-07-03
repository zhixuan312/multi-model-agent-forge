import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { project, buildPr } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { connectionSettings } from '@/db/schema/identity';
import { createBuildPr } from '@/build/pr';
import { buildForgeBranch } from '@/build/execute-core';
import { projectShortId } from '@/build/slug';
import { logAction } from '@/observability/action-log';
import { execFileSync } from 'node:child_process';
import { validateDetails } from '@/details/schema';

export const runtime = 'nodejs';

const bodySchema = z.object({ repoId: z.string().uuid() });

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const csrf = rejectCrossOrigin(_req);
  if (csrf) return csrf;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  const json = await _req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'repoId required' }, { status: 400 });
  const { repoId } = parsed.data;

  const db = getDb();

  // Read tasks from details
  const [projRow] = await db.select({ name: project.name, details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!projRow?.details) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const d = validateDetails(projRow.details);
  const tasks = d.stages.plan.phases.refine.tasks.filter((t) => t.targetRepoId === repoId);

  if (tasks.length === 0) return NextResponse.json({ error: 'No tasks for this repo' }, { status: 400 });
  if (!tasks.every((t) => t.status === 'committed')) return NextResponse.json({ error: 'Not all tasks committed' }, { status: 400 });

  const [repoRow] = await db.select({ name: repo.name, pathOnDisk: repo.pathOnDisk }).from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!repoRow) return NextResponse.json({ error: 'Repo not found' }, { status: 404 });

  const shortId = projectShortId(id);
  const forgeBranch = tasks[0].branch ?? buildForgeBranch(projRow.name ?? id, shortId);
  const targetBranch = tasks[0].targetBranch ?? 'main';

  try {
    execFileSync('git', ['-C', repoRow.pathOnDisk, 'push', 'origin', forgeBranch, '--force'], { timeout: 60_000 });
  } catch (pushErr) {
    return NextResponse.json({ error: `Push failed: ${(pushErr as Error).message}` }, { status: 500 });
  }

  const [settings] = await db.select({ ref: connectionSettings.gitTokenRef }).from(connectionSettings).limit(1);
  let gitToken: string | null = null;
  if (settings?.ref) {
    const { PostgresSecretStore } = await import('@/secrets/secret-store');
    const secrets = await PostgresSecretStore.create({ db });
    gitToken = await secrets.get(settings.ref);
  }
  if (!gitToken) return NextResponse.json({ error: 'No git token configured' }, { status: 400 });

  const pr = await createBuildPr(
    {
      readGitToken: async () => gitToken,
      parseRemote: (path) => {
        try {
          const url = execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
          const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
          return m ? { owner: m[1], repo: m[2] } : null;
        } catch { return null; }
      },
      branchHasChanges: async () => true,
      fetch: globalThis.fetch,
    },
    {
      projectName: projRow.name ?? id,
      branch: forgeBranch,
      targetBranch,
      repoPath: repoRow.pathOnDisk,
      tasks: tasks.map((t) => ({ title: t.title, commitSha: t.commitSha ?? null })),
    },
  );

  if (!pr) return NextResponse.json({ error: 'No changes to create PR' }, { status: 400 });
  if ('error' in pr) return NextResponse.json({ error: pr.error }, { status: 502 });

  await db
    .insert(buildPr)
    .values({ projectId: id, repoId, url: pr.url, branch: forgeBranch, targetBranch })
    .onConflictDoUpdate({
      target: [buildPr.projectId, buildPr.repoId],
      set: { url: pr.url, branch: forgeBranch, targetBranch },
    });

  await logAction({ projectId: id, memberId: me.id, action: 'create_pr', target: `repo:${repoRow.name}` }, db);

  return NextResponse.json({ url: pr.url });
}
