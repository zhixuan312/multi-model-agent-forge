import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { extractJsonFromEnvelope, registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

const TYPE_MAP: Record<string, 'challenge' | 'insight' | 'decision'> = {
  decision: 'decision', design: 'decision', process: 'insight',
  behavior: 'insight', knowledge: 'insight', style: 'insight',
  challenge: 'challenge',
};

const ORIGIN_MAP: Record<string, 'exploration' | 'spec'> = {
  Exploration: 'exploration', Spec: 'spec', Plan: 'spec',
  Execute: 'spec', Review: 'spec', Journal: 'spec', Manual: 'spec',
};

async function handleJournalHarvest(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const output = ((envelope as Record<string, unknown>)?.output ?? {}) as Record<string, unknown>;
  let summaryRaw: unknown = output.summary;
  if (typeof summaryRaw === 'string') {
    const stripped = summaryRaw.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '').trim();
    try { summaryRaw = JSON.parse(stripped); } catch { summaryRaw = stripped; }
  }

  const learnings = Array.isArray(summaryRaw) ? summaryRaw as unknown[] : [];

  for (const l of learnings) {
    const entry = l as { text?: string; category?: string; source?: string };
    if (!entry.text) continue;
    const cat = entry.category ?? 'knowledge';
    const src = entry.source ?? 'Spec';
    await db.insert(learningCandidate).values({
      projectId: ctx.projectId,
      bodyMd: `[category:${cat}][source:${src}] ${String(entry.text)}`,
      type: TYPE_MAP[cat] ?? 'insight',
      origin: ORIGIN_MAP[src] ?? 'spec',
      status: 'proposed',
    });
  }
}

registerHandler('journal-harvest', handleJournalHarvest);
