import { eq, asc } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { ComposeLearningsSchema } from '@/spec/schemas';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

function extractResponseText(envelope: unknown): string {
  const env = envelope as { structuredReport?: { summary?: string } };
  const summary = env?.structuredReport?.summary ?? '';
  if (summary) return summary.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  throw new Error('No parseable response in MMA envelope');
}

async function handleSpecLearnings(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  // Idempotent: if candidates already exist, skip
  const existing = await db
    .select({ id: learningCandidate.id })
    .from(learningCandidate)
    .where(eq(learningCandidate.projectId, ctx.projectId))
    .limit(1);
  if (existing.length > 0) return;

  const raw = extractResponseText(envelope);
  const out = ComposeLearningsSchema.parse(JSON.parse(raw));

  if (out.candidates.length === 0) return;

  await db
    .insert(learningCandidate)
    .values(
      out.candidates.map((c) => ({
        projectId: ctx.projectId,
        bodyMd: c.bodyMd,
        type: c.type,
        origin: 'spec' as const,
        status: 'proposed' as const,
        createdBy: null,
      })),
    );
}

registerHandler('spec-learnings', handleSpecLearnings);
