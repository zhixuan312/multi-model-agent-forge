import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { explorationTask } from '@/db/schema/exploration';
import { project } from '@/db/schema/projects';
import { ProposalSchema, PROMPT_FLOORS, type ProposedTask } from '@/exploration/schemas';
import { logAction } from '@/observability/action-log';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

function extractResponseText(envelope: unknown): string {
  const env = envelope as { structuredReport?: { summary?: string } };
  const summary = env?.structuredReport?.summary ?? '';
  if (summary) return summary.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  throw new Error('No parseable response in MMA envelope');
}

async function handleExplorePropose(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractResponseText(envelope);
  const proposal = ProposalSchema.parse(JSON.parse(raw));
  const request = ctx.request as { actorId: string; repoIds?: string[] };
  const repoIds = new Set(request.repoIds ?? []);

  const conformant: ProposedTask[] = [];
  for (const t of proposal.tasks) {
    if (t.kind !== 'investigate' && t.kind !== 'research' && t.kind !== 'journal') continue;
    if (t.kind === 'investigate' && (!t.targetRepoId || !repoIds.has(t.targetRepoId))) continue;
    if (t.kind !== 'investigate' && t.targetRepoId != null) continue;
    const floor = PROMPT_FLOORS[t.kind];
    if (t.prompt.trim().length < floor) continue;
    conformant.push(t);
  }

  if (conformant.length === 0) return;

  await db.transaction(async (tx) => {
    await tx
      .delete(explorationTask)
      .where(and(eq(explorationTask.projectId, ctx.projectId), eq(explorationTask.status, 'draft')));
    await tx
      .insert(explorationTask)
      .values(
        conformant.map((t) => ({
          projectId: ctx.projectId,
          kind: t.kind,
          targetRepoId: t.kind === 'investigate' ? t.targetRepoId! : null,
          prompt: t.prompt.trim(),
          status: 'draft' as const,
          createdBy: request.actorId,
        })),
      );
    await tx.update(project).set({ updatedAt: new Date() }).where(eq(project.id, ctx.projectId));
    await logAction(
      { projectId: ctx.projectId, memberId: request.actorId, action: 'explore_analyze', target: `project:${ctx.projectId}`, meta: { taskCount: conformant.length } },
      tx as unknown as Db,
    );
  });
}

registerHandler('explore-propose', handleExplorePropose);
