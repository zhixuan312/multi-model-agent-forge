import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { guardBuildWrite } from '@/build/guard';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { getDb } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { getLatestSpec } from '@/spec/assemble';
import { buildPlanRefinePrompt } from '@/plan/plan-refine-prompt';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, taskId } = await ctx.params;

  const guard = await guardBuildWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();

  const existing = await findInflight(db, id, 'plan-refine');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const [task] = await db
    .select({ title: planTask.title, detail: planTask.detail })
    .from(planTask)
    .where(eq(planTask.id, taskId))
    .limit(1);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const userMessage = body.message ?? '';
  if (!userMessage.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  const spec = await getLatestSpec(db, id);
  const { system, user } = buildPlanRefinePrompt({
    taskTitle: task.title,
    taskBody: task.detail ?? '',
    userMessage,
    specMd: spec?.bodyMd,
  });

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'plan-refine',
    cwd: resolveWorkspaceRoot(),
    body: {
      prompt: `${system}\n\n${user}`,
      reviewPolicy: 'none',
    },
    actorId: guard.memberId,
    meta: { taskId },
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
