import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { artifact, learningCandidate } from '@/db/schema/artifacts';
import { mmaBatch } from '@/db/schema/mma';
import { buildMmaClient } from '@/mma/server-client';
import { projectEventBus } from '@/sse/event-bus';
import { extractUsageFields } from '@/usage/extract-usage-fields';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

/**
 * `POST /api/projects/[id]/journal/harvest` — auto-extract learnings from the
 * project's full run via MMA orchestrate. Collects spec + plan + execute/review
 * results, sends them to MMA, parses the structured learning candidates, and
 * inserts them into `project_learning_candidate`.
 */
export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const csrf = rejectCrossOrigin(_req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw e;
  }

  const db = getDb();
  const proj = await getProject(id);
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Collect project artifacts for context
  const artifacts = await db
    .select({ kind: artifact.kind, bodyMd: artifact.bodyMd, version: artifact.version })
    .from(artifact)
    .where(eq(artifact.projectId, id))
    .orderBy(artifact.kind, desc(artifact.version));

  // Deduplicate to latest version per kind
  const latestByKind = new Map<string, string>();
  for (const a of artifacts) {
    if (!latestByKind.has(a.kind)) latestByKind.set(a.kind, a.bodyMd);
  }

  // Collect review/execute results
  const batches = await db
    .select({ route: mmaBatch.route, result: mmaBatch.result })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.status, 'done')))
    .orderBy(desc(mmaBatch.createdAt));

  const executeSummary = batches.find((b) => b.route === 'execute_plan');
  const reviewSummary = batches.find((b) => b.route === 'review');

  // Build the harvest prompt — include ALL 5 lifecycle stages
  const sections: string[] = [];
  sections.push(`# Project: ${proj.name}`);
  if (proj.intentMd) sections.push(`## Intent\n${proj.intentMd}`);

  const explorationMd = latestByKind.get('exploration');
  if (explorationMd) sections.push(`## Exploration findings\n${explorationMd.slice(0, 6000)}`);

  const specMd = latestByKind.get('spec');
  if (specMd) sections.push(`## Specification (latest)\n${specMd.slice(0, 8000)}`);

  const planMd = latestByKind.get('plan');
  if (planMd) sections.push(`## Plan (latest)\n${planMd.slice(0, 8000)}`);

  if (executeSummary?.result) {
    const env = executeSummary.result as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
    sections.push(`## Execute results\n${summary.slice(0, 4000)}`);
  }

  if (reviewSummary?.result) {
    const env = reviewSummary.result as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
    sections.push(`## Review findings\n${summary.slice(0, 4000)}`);
  }

  const prompt = `You are the learning harvester for a software delivery project. Given the project's full lifecycle artifacts below, extract 8-15 distinct learnings.

Each learning should be a concrete, reusable principle — NOT a description of what was done, but WHAT WAS LEARNED. Frame each as a lesson another team could apply.

For each learning, provide:
- text: The learning as a clear, actionable statement (1-3 sentences)
- category: One of: decision, design, behavior, process, knowledge, style
- source: Which stage it came from: Exploration, Spec, Plan, Execute, Review, Journal
- tags: 2-3 short keyword tags

Return a JSON array:
\`\`\`json
[
  { "text": "...", "category": "decision", "source": "Spec", "tags": ["architecture", "trade-off"] },
  ...
]
\`\`\`

---

${sections.join('\n\n')}`;

  // Dispatch to MMA orchestrate
  const mma = await buildMmaClient();
  let batchId: string;
  try {
    ({ batchId } = await mma.dispatch('orchestrate', {
      cwd: resolveWorkspaceRoot(),
      body: { type: 'orchestrate', prompt, reviewPolicy: 'none' },
    }));
  } catch (err) {
    return NextResponse.json(
      { error: `MMA dispatch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const [batchRow] = await db
    .insert(mmaBatch)
    .values({
      projectId: id,
      route: 'orchestrate',
      handler: 'journal-harvest',
      cwd: resolveWorkspaceRoot(),
      batchId,
      status: 'dispatched',
      request: { prompt: 'harvest learnings' },
      dispatchedBy: me.id,
    })
    .returning({ id: mmaBatch.id });

  projectEventBus.publish(id, {
    type: 'dispatch.progress',
    batchId: batchRow.id,
    handler: 'journal-harvest',
    phase: 'implementing',
    elapsedMs: 0,
  });

  // Background poll → insert learning candidates
  pollAndInsert(mma, db, batchId, batchRow.id, id, me.id).catch((err) => {
    console.error(`[forge] journal harvest failed for project ${id}:`, err);
    projectEventBus.publish(id, {
      type: 'dispatch.failed',
      batchId: batchRow.id,
      handler: 'journal-harvest',
      error: (err as Error).message,
    });
  });

  return NextResponse.json({ ok: true, batchId: batchRow.id }, { status: 202 });
}

async function pollAndInsert(
  mma: Awaited<ReturnType<typeof buildMmaClient>>,
  db: ReturnType<typeof getDb>,
  mmaBatchId: string,
  batchRowId: string,
  projectId: string,
  actorId: string,
): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await mma.poll(mmaBatchId);

    if (res.state === 'pending') {
      await db.update(mmaBatch).set({ status: 'running' }).where(eq(mmaBatch.id, batchRowId));
      projectEventBus.publish(projectId, {
        type: 'dispatch.progress',
        batchId: batchRowId,
        handler: 'journal-harvest',
        phase: res.phase ?? 'running',
        elapsedMs: res.elapsedMs ?? 0,
      });
      continue;
    }

    if (res.state === 'not_found') {
      throw new Error('MMA task no longer exists — the server may have restarted.');
    }

    // Terminal
    const envelope = res.envelope as Record<string, unknown> | null;
    const error = envelope?.error as { code: string; message: string } | null;
    const usage = extractUsageFields(envelope);

    await db.update(mmaBatch).set({
      status: error ? 'failed' : 'done',
      result: envelope as object,
      terminalAt: new Date(),
      ...(usage.costUsd && { costUsd: usage.costUsd }),
      ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
    }).where(eq(mmaBatch.id, batchRowId));

    if (!error) {
      // Parse learnings from output.summary
      const output = (envelope?.output ?? {}) as Record<string, unknown>;
      let summaryRaw: unknown = output.summary;
      if (typeof summaryRaw === 'string') {
        const stripped = summaryRaw.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '').trim();
        try { summaryRaw = JSON.parse(stripped); } catch { summaryRaw = stripped; }
      }

      const learnings = Array.isArray(summaryRaw) ? summaryRaw as unknown[] : [];

      // Map MMA categories to DB enum: challenge|insight|decision
      const TYPE_MAP: Record<string, 'challenge' | 'insight' | 'decision'> = {
        decision: 'decision', design: 'decision', process: 'insight',
        behavior: 'insight', knowledge: 'insight', style: 'insight',
        challenge: 'challenge',
      };
      // Map source stage to DB enum: exploration|spec
      const ORIGIN_MAP: Record<string, 'exploration' | 'spec'> = {
        Exploration: 'exploration', Spec: 'spec', Plan: 'spec',
        Execute: 'spec', Review: 'spec', Journal: 'spec', Manual: 'spec',
      };

      for (const l of learnings) {
        const entry = l as { text?: string; category?: string; source?: string };
        if (!entry.text) continue;
        const cat = entry.category ?? 'knowledge';
        const src = entry.source ?? 'Spec';
        await db.insert(learningCandidate).values({
          projectId,
          bodyMd: `[category:${cat}][source:${src}] ${String(entry.text)}`,
          type: TYPE_MAP[cat] ?? 'insight',
          origin: ORIGIN_MAP[src] ?? 'spec',
          status: 'proposed',
        });
      }
    }

    projectEventBus.publish(projectId, {
      type: 'dispatch.done',
      batchId: batchRowId,
      handler: 'journal-harvest',
    });

    break;
  }
}
