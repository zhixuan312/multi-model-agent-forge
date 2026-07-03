import type { Db } from '@/db/client';
import { ComposeLearningsSchema } from '@/spec/schemas';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';

async function handleSpecLearnings(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const raw = extractJsonFromEnvelope(envelope);
  const out = ComposeLearningsSchema.parse(JSON.parse(raw));
  if (out.candidates.length === 0) return;

  await updateDetails(db, ctx.projectId, (d) => {
    if (d.stages.journal.phases.journal.learnings.length > 0) return d;
    for (const c of out.candidates) {
      d.stages.journal.phases.journal.learnings.push({
        heading: c.bodyMd.split('\n')[0].replace(/^\[.*?\]/, '').trim().slice(0, 120),
        type: (c.type === 'decision' ? 'decision' : 'insight') as 'decision' | 'insight',
        status: 'proposed',
      });
    }
    return d;
  });
}

registerHandler('spec-learnings', handleSpecLearnings);
