import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { mmaBatch } from '@/db/schema/mma';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { journalFilePath } from '@/projects/project-files';
import '@/dispatch/handler-registry';

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
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  const db = getDb();

  const existing = await findInflight(db, id, 'journal-harvest');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const proj = await getProject(id);
  if (!proj) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Collect project artifacts for context
  const artifacts = await db.select({ kind: artifact.kind, bodyMd: artifact.bodyMd, version: artifact.version })
    .from(artifact).where(eq(artifact.projectId, id)).orderBy(artifact.kind, desc(artifact.version));
  const latestByKind = new Map<string, string>();
  for (const a of artifacts) {
    if (!latestByKind.has(a.kind)) latestByKind.set(a.kind, a.bodyMd);
  }

  const batches = await db.select({ route: mmaBatch.route, result: mmaBatch.result })
    .from(mmaBatch).where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.status, 'done'))).orderBy(desc(mmaBatch.createdAt));
  const executeSummary = batches.find((b) => b.route === 'execute_plan');
  const reviewSummary = batches.find((b) => b.route === 'review');

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

  const journalPath = journalFilePath(id);

  const prompt = `Role: You are the learning harvester for Forge, a software delivery harness.

Task: Given the project's full lifecycle artifacts below, extract 8-15 distinct learnings that another team could reuse. Write them to \`${journalPath}\`.

Context: This project has completed all 5 stages: Exploration, Spec, Plan, Execute, Review. The artifacts below summarize what happened at each stage.

Input:

${sections.join('\n\n')}

Constraints:
- Each learning is a concrete, reusable principle — NOT a description of what was done
- Frame each as a lesson: what was learned, why it matters, when to apply it
- Cover all stages — don't cluster learnings in one area
- Deduplicate: if two stages surfaced the same insight, merge into one learning

Output format:
Write the ENTIRE learning set to \`${journalPath}\` using this markdown structure:

## Category Name (e.g. "Decision", "Process", "Knowledge")

### Learning title (clear, actionable statement)

The learning body — 1-3 sentences explaining what was learned, why it matters, and when to apply it.

**Source:** Which stage it came from (Exploration, Spec, Plan, Execute, Review)
**Tags:** keyword1, keyword2

Group learnings under ## category headings. Use ### for each learning. Categories: Decision, Design, Behavior, Process, Knowledge, Style.
Write the file to \`${journalPath}\`. This is MANDATORY.`;

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'journal-harvest',
    cwd: resolveWorkspaceRoot(),
    body: { prompt, reviewPolicy: 'none' },
    actorId: me.id,
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
