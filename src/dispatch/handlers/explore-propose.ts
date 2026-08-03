import { randomUUID } from 'node:crypto';
import { ensureDiscoverTaskIds } from '@/exploration/explore-core';
import type { Db } from '@/db/client';
import { DISCOVER_TASK_KIND, type DiscoverTaskKind } from '@/db/enums';
import { ProposalSchema, PROMPT_FLOORS, type ProposedTask } from '@/exploration/schemas';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';
import { logEvent } from '@/observability/log-event';

async function handleExplorePropose(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const proposal = ProposalSchema.parse(JSON.parse(raw));
  const request = ctx.request as { actorId: string; repoIds?: string[] };
  const repoIds = new Set(request.repoIds ?? []);

  const conformant: ProposedTask[] = [];
  const rejected: string[] = [];
  for (const t of proposal.tasks) {
    const reject = (why: string): void => { rejected.push(`${t.kind ?? 'unknown'}: ${why}`); };
    if (!(DISCOVER_TASK_KIND as readonly string[]).includes(t.kind as string)) { reject('unknown kind'); continue; }
    if (t.kind === 'investigate' && (!t.targetRepoId || !repoIds.has(t.targetRepoId))) { reject('investigate without a linked repo'); continue; }
    if (t.kind !== 'investigate' && t.targetRepoId != null) { reject('non-investigate task named a repo'); continue; }
    const floor = PROMPT_FLOORS[t.kind];
    if (t.prompt.trim().length < floor) { reject(`prompt under the ${floor}-char floor`); continue; }
    conformant.push(t);
  }

  // Dropping a non-conformant proposal is right; dropping it SILENTLY is not. With no
  // record, "the model proposed nothing" and "everything it proposed was rejected" look
  // identical — an empty Discover list either way, and no way to tell which.
  if (rejected.length > 0) {
    logEvent({
      event: 'explore.proposals_rejected',
      level: conformant.length === 0 ? 'warn' : 'info',
      projectId: ctx.projectId,
      count: rejected.length,
      detail: `${conformant.length} kept of ${proposal.tasks.length}; rejected — ${rejected.join('; ')}`,
    });
  }

  if (conformant.length === 0) return;

  await updateDetails(db, ctx.projectId, (d) => {
    ensureDiscoverTaskIds(d.stages.exploration.phases.discover.tasks);
    const kept = d.stages.exploration.phases.discover.tasks.filter((t) => t.status !== 'draft');
    // The enum's own order, so the stored order and the rail's grouping cannot disagree.
    const sortOrder: Record<string, number> = Object.fromEntries(DISCOVER_TASK_KIND.map((k, i) => [k, i]));
    const newTasks = conformant
      .sort((a, b) => (sortOrder[a.kind] ?? 9) - (sortOrder[b.kind] ?? 9))
      .map((t) => ({
        id: randomUUID(),
        kind: t.kind as DiscoverTaskKind,
        prompt: t.prompt.trim(),
        status: 'draft' as const,
        ...(t.title?.trim() ? { title: t.title.trim() } : {}),
        ...(t.kind === 'investigate' && t.targetRepoId ? { repoId: t.targetRepoId } : {}),
        attempts: [],
      }));
    d.stages.exploration.phases.discover.tasks = [...kept, ...newTasks];
    return d;
  });
}

registerHandler('explore-propose', handleExplorePropose);
