import { and, eq, max } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { repo } from '@/db/schema/workspace';
import { SynthesisSchema, composeExplorationMarkdown } from '@/exploration/schemas';
import { gapMarker } from '@/exploration/synthesize';
import { logAction } from '@/observability/action-log';
import { projectEventBus } from '@/sse/event-bus';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';


async function handleExploreSynthesize(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const synthesis = SynthesisSchema.parse(JSON.parse(raw));
  const request = ctx.request as { actorId: string };

  // Get failure markers for gap injection
  const rows = await db
    .select({ route: mmaBatch.route, batchStatus: mmaBatch.status, repoName: repo.name })
    .from(explorationTask)
    .innerJoin(mmaBatch, eq(explorationTask.mmaBatchId, mmaBatch.id))
    .leftJoin(repo, eq(explorationTask.targetRepoId, repo.id))
    .where(and(eq(explorationTask.projectId, ctx.projectId), eq(explorationTask.status, 'recorded')));
  const failures = rows.filter((r) => r.batchStatus === 'failed');
  const failureMarkers = failures.map((r) => gapMarker(r.route as 'investigate' | 'research' | 'journal_recall', r.repoName));

  let findings = synthesis.findings;
  for (const marker of failureMarkers) {
    if (!findings.includes(marker)) {
      findings = `${findings.trim()}\n\n${marker}`;
    }
  }
  const bodyMd = composeExplorationMarkdown({ ...synthesis, findings });

  const [{ v } = { v: null }] = await db
    .select({ v: max(artifact.version) })
    .from(artifact)
    .where(and(eq(artifact.projectId, ctx.projectId), eq(artifact.kind, 'exploration')));
  const nextVersion = (v ?? 0) + 1;

  const [a] = await db
    .insert(artifact)
    .values({ projectId: ctx.projectId, kind: 'exploration', bodyMd, version: nextVersion, createdBy: request.actorId || null })
    .returning({ id: artifact.id });

  await logAction(
    { projectId: ctx.projectId, memberId: request.actorId || 'system', action: 'synthesize', target: `artifact:${a.id}` },
    db,
  );

  projectEventBus.publish(ctx.projectId, { type: 'synthesis.updated', artifactId: a.id, version: nextVersion });
}

registerHandler('explore-synthesize', handleExploreSynthesize);
