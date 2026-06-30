import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/ops';
import { repo } from '@/db/schema/workspace';
import { SynthesisSchema, composeExplorationMarkdown } from '@/exploration/schemas';
import { gapMarker } from '@/exploration/synthesize';
import { writeExplorationSummaryAsync } from '@/projects/project-files';
import { logAction } from '@/observability/action-log';
import { projectEventBus } from '@/sse/event-bus';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';


async function handleExploreSynthesize(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const env = (envelope ?? {}) as Record<string, unknown>;
  const output = (env.output ?? {}) as Record<string, unknown>;
  const summaryRaw = output.summary;

  let synthesis;
  if (summaryRaw && typeof summaryRaw === 'object' && !Array.isArray(summaryRaw)) {
    synthesis = SynthesisSchema.parse(summaryRaw);
  } else {
    const raw = typeof summaryRaw === 'string' ? summaryRaw : extractJsonFromEnvelope(envelope);
    try {
      synthesis = SynthesisSchema.parse(JSON.parse(raw));
    } catch {
      const text = raw;
      const bg = text.match(/\*\*Background\*\*[:\s]*\n?([\s\S]*?)(?=\*\*Current state\*\*|\*\*Rough direction\*\*|$)/i)?.[1]?.trim() ?? '';
      const cs = text.match(/\*\*Current state\*\*[:\s]*\n?([\s\S]*?)(?=\*\*Rough direction\*\*|$)/i)?.[1]?.trim() ?? '';
      const rd = text.match(/\*\*Rough direction\*\*[:\s]*\n?([\s\S]*?)$/i)?.[1]?.trim() ?? '';
      synthesis = { background: bg || text, currentState: cs, roughDirection: rd };
    }
  }
  const request = ctx.request as { actorId: string };

  const rows = await db
    .select({ route: mmaBatch.route, batchStatus: mmaBatch.status, repoName: repo.name })
    .from(explorationTask)
    .innerJoin(mmaBatch, eq(explorationTask.mmaBatchId, mmaBatch.id))
    .leftJoin(repo, eq(explorationTask.targetRepoId, repo.id))
    .where(and(eq(explorationTask.projectId, ctx.projectId), eq(explorationTask.status, 'recorded')));
  const failures = rows.filter((r) => r.batchStatus === 'failed');
  const failureMarkers = failures.map((r) => gapMarker(r.route as 'investigate' | 'research' | 'journal_recall', r.repoName));

  let currentState = synthesis.currentState;
  for (const marker of failureMarkers) {
    if (!currentState.includes(marker)) {
      currentState = `${currentState.trim()}\n\n${marker}`;
    }
  }
  const bodyMd = composeExplorationMarkdown({ ...synthesis, currentState });

  const filePath = await writeExplorationSummaryAsync(ctx.projectId, bodyMd);

  await logAction(
    { projectId: ctx.projectId, memberId: request.actorId || 'system', action: 'synthesize', target: `file:${filePath}` },
    db,
  );

  projectEventBus.publish(ctx.projectId, { type: 'synthesis.updated', artifactId: ctx.projectId, version: 1 });
}

registerHandler('explore-synthesize', handleExploreSynthesize);
