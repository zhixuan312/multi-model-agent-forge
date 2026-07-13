import type { Db } from '@/db/client';
import { ProposalSchema, PROMPT_FLOORS, type ProposedTask } from '@/exploration/schemas';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';

async function handleExplorePropose(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
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

  await updateDetails(db, ctx.projectId, (d) => {
    const kept = d.stages.exploration.phases.discover.tasks.filter((t) => t.status !== 'draft');
    const sortOrder: Record<string, number> = { investigate: 0, research: 1, journal: 2 };
    const newTasks = conformant
      .sort((a, b) => (sortOrder[a.kind] ?? 9) - (sortOrder[b.kind] ?? 9))
      .map((t) => ({
        kind: t.kind as 'investigate' | 'research' | 'journal',
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
