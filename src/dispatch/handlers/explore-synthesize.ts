import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { SynthesisSchema, composeExplorationMarkdown } from '@/exploration/schemas';
import { gapMarker } from '@/exploration/synthesize';
import { backupArtifact, writeExplorationSummaryAsync } from '@/projects/project-files';
import { logAction } from '@/observability/action-log';
import { projectEventBus } from '@/sse/event-bus';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';

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

  let failureMarkers: string[] = [];
  const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
  if (pRow?.details) {
    const d = validateDetails(pRow.details);
    const tasks = d.stages.exploration.phases.discover.tasks;
    for (const t of tasks) {
      const lastAttempt = t.attempts[t.attempts.length - 1];
      if (lastAttempt?.status === 'failed') {
        const route = t.kind === 'journal' ? 'journal_recall' : t.kind;
        const repoName = t.repoId
          ? (await db.select({ name: repo.name }).from(repo).where(eq(repo.id, t.repoId)).limit(1))[0]?.name ?? null
          : null;
        failureMarkers.push(gapMarker(route as 'investigate' | 'research' | 'journal_recall', repoName));
      }
    }
  }

  let currentState = synthesis.currentState;
  for (const marker of failureMarkers) {
    if (!currentState.includes(marker)) {
      currentState = `${currentState.trim()}\n\n${marker}`;
    }
  }
  const bodyMd = composeExplorationMarkdown({ ...synthesis, currentState });

  await backupArtifact(ctx.projectId, 'exploration.md');
  const filePath = await writeExplorationSummaryAsync(ctx.projectId, bodyMd);

  // Record the synthesized artifact path on the phase — this is what gates the
  // "Continue to Spec" advance: allowedActions offers advance_stage only once
  // synthesize.file is set (otherwise it offers dispatch_synthesize / Re-synthesize).
  await updateDetails(db, ctx.projectId, (d) => {
    d.stages.exploration.phases.synthesize.file = filePath;
    return d;
  });

  await logAction(
    { projectId: ctx.projectId, memberId: request.actorId || 'system', action: 'synthesize', target: `file:${filePath}` },
    db,
  );

  projectEventBus.publish(ctx.projectId, { type: 'synthesis.updated', artifactId: ctx.projectId, version: 1 });
}

registerHandler('explore-synthesize', handleExploreSynthesize);
