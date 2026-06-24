import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guardBuildWrite } from '@/build/guard';
import { artifact } from '@/db/schema/artifacts';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import '@/dispatch/handler-registry';

type Ctx = { params: Promise<{ id: string }> };

const findingSchema = z.object({
  severity: z.string(),
  category: z.string(),
  claim: z.string(),
  evidence: z.string().optional(),
  suggestion: z.string().optional(),
});

const bodySchema = z.object({
  findings: z.array(findingSchema),
});

const REVISE_SYSTEM = `You are Forge's plan reviser. You receive an implementation plan and audit findings. Revise ONLY the affected tasks to address each finding.

Rules:
- Return ONLY the tasks you changed — not the entire plan.
- For each changed task, return its title (EXACT match to identify it) and the revised detail.
- Maintain the same TDD task structure (Files, Test, Implementation, Run).
- Do NOT rename tasks. Keep titles stable.
- If a finding requires a NEW task, add it with a new unique title.

Return a JSON object:
{ "revisedTasks": [{ "title": "exact task title", "detail": "revised detail markdown" }], "newTasks": [{ "title": "new task title", "detail": "...", "dependsOn": [], "reviewPolicy": "full" }] }

Return ONLY the JSON. No commentary.`;

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  const guard = await guardBuildWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const db = getDb();

  const existing = await findInflight(db, id, 'plan-audit-apply');
  if (existing) {
    return NextResponse.json({ batchId: existing, status: 'already_running' }, { status: 202 });
  }

  const [planArt] = await db
    .select({ bodyMd: artifact.bodyMd })
    .from(artifact)
    .where(and(eq(artifact.projectId, id), eq(artifact.kind, 'plan')))
    .orderBy(artifact.version)
    .limit(1);

  if (!planArt) {
    return NextResponse.json({ error: 'No plan artifact found.' }, { status: 409 });
  }

  const findings = parsed.data.findings;
  const findingsBlock = findings
    .map((f, i) => {
      let line = `${i + 1}. [${f.severity.toUpperCase()}] ${f.category}: ${f.claim}`;
      if (f.evidence) line += `\n   Evidence: ${f.evidence}`;
      if (f.suggestion) line += `\n   Suggested fix: ${f.suggestion}`;
      return line;
    })
    .join('\n\n');

  const prompt = `${REVISE_SYSTEM}\n\n# Current plan\n${planArt.bodyMd}\n\n# Audit findings to address\n${findingsBlock}`;

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'plan-audit-apply',
    cwd: resolveWorkspaceRoot(),
    body: { prompt, reviewPolicy: 'none' },
    actorId: guard.memberId,
    meta: { actorId: guard.memberId },
  });

  return NextResponse.json({ batchId: batchRowId }, { status: 202 });
}
