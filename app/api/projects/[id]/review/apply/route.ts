import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
import '@/dispatch/handler-registry';

export const runtime = 'nodejs';

const bodySchema = z.object({
  passNo: z.number().int().positive(),
  findingIndices: z.array(z.number().int().nonnegative()).min(1),
});

function buildFixPrompt(findings: Array<Record<string, unknown>>): string {
  const findingsBlock = findings.map((f, i) => {
    const parts = [`${i + 1}. [${(f.weight as string)?.toUpperCase() ?? 'MEDIUM'}] ${f.category ?? ''}: ${f.claim ?? ''}`];
    if (f.file) parts.push(`   File: ${f.file}${f.line ? ':' + f.line : ''}`);
    if (f.evidence) parts.push(`   Evidence: ${f.evidence}`);
    if (f.suggestion) parts.push(`   Suggested fix: ${f.suggestion}`);
    return parts.join('\n');
  }).join('\n\n');

  return `Role: You are a code review fix applicator for Forge, a software delivery harness. You apply targeted code fixes from review findings to the working codebase.

Task: Read each code review finding below, locate the cited file and line, apply the suggested fix, then verify the codebase still compiles and tests pass. Make the fixes directly to the files.

Context: A code review pass flagged the findings listed below. Each finding cites a specific file, line, claim (what is wrong), evidence (how the reviewer found it), and a suggested fix.

Input:

--- Code Review Findings to Fix ---
${findingsBlock}
--- End Findings ---

Constraints:
- Address EVERY finding — use the file path and line to locate the exact code
- Make minimal, targeted changes — do not refactor, restructure, or "improve" beyond what the finding requires
- Preserve all code not touched by a finding
- After all fixes, run the project's test suite to verify nothing broke
- Do NOT run git commit — leave your edits in the working tree; the harness commits them for you

Output format:
Make the fixes directly to the files. Do NOT commit. No other output is required — the harness reads the git diff.`;
}

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

  const json = await _req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'passNo + findingIndices required' }, { status: 400 });
  const { passNo, findingIndices } = parsed.data;

  const db = getDb();

  const existing = await findInflight(db, id, 'review-apply');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  // Find the review batch for this pass
  const reviewBatches = await db
    .select({ id: mmaBatch.id, result: mmaBatch.result, targetRepoId: mmaBatch.targetRepoId, cwd: mmaBatch.cwd })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.handler, 'code-review'), eq(mmaBatch.status, 'done')))
    .orderBy(mmaBatch.createdAt);

  const passBatch = reviewBatches[passNo - 1];
  if (!passBatch) return NextResponse.json({ error: `Pass ${passNo} not found` }, { status: 404 });

  // Extract findings from the batch result
  const env = passBatch.result as Record<string, unknown> | null;
  const output = (env?.output ?? {}) as Record<string, unknown>;
  let summary = output.summary;
  if (typeof summary === 'string') {
    try { summary = JSON.parse(summary.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')); } catch {}
  }
  const allFindings = (summary as Record<string, unknown>)?.findings;
  if (!Array.isArray(allFindings)) return NextResponse.json({ error: 'No findings in pass result' }, { status: 400 });

  const selected = findingIndices.map((i) => allFindings[i]).filter(Boolean) as Array<Record<string, unknown>>;
  if (selected.length === 0) return NextResponse.json({ error: 'No valid findings selected' }, { status: 400 });

  const cwd = passBatch.cwd;
  const prompt = buildFixPrompt(selected);

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    // `delegate` (worktree route): MMA commits the fixes + ff-merges them onto the
    // forge branch — same as the auto driver. handleReviewApply records the pass +
    // pushes (it does NOT commit). Matches the auto path exactly (one implementation).
    route: 'delegate',
    handler: 'review-apply',
    cwd: cwd!,
    body: {
      prompt,
      reviewPolicy: 'none',
    },
    actorId: me.id,
    meta: { passNo, findingIndices, findingsCount: selected.length, repoId: passBatch.targetRepoId, cwd },
  });

  return NextResponse.json({ batchId: batchRowId, findingsCount: selected.length }, { status: 202 });
}
