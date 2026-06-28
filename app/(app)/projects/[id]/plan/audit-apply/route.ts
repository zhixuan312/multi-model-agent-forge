import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardBuildWrite } from '@/build/guard';
import { planFilePath } from '@/projects/project-files';
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
  passNo: z.number().int().positive().optional(),
});

function buildRevisePrompt(planPath: string, findingsBlock: string): string {
  return `Role: You are a plan reviser for Forge, a software delivery harness.

Task: Read the implementation plan at \`${planPath}\`, apply every audit finding listed below, and write the revised plan back to the SAME file.

Constraints:
- Address EVERY finding — use the evidence to locate the exact passage and the suggestion as guidance
- Preserve the plan structure: # title, ## phase headings, ### task headings, - [ ] checkbox steps, \`\`\` code fences
- Do NOT add or remove ### task sections — only revise content within existing sections
- Do NOT rename ### task headings — they are stable keys used by the harness
- Do NOT add git commit/push steps — the harness owns commits
- Preserve all content not touched by a finding
- Write the FULL revised plan back to \`${planPath}\` — not a diff, the complete file

Findings to address:

${findingsBlock}`;
}

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

  const { findings, passNo } = parsed.data;
  if (findings.length === 0) {
    return NextResponse.json({ error: 'No findings to apply.' }, { status: 422 });
  }

  const findingsBlock = findings
    .map((f, i) => {
      let line = `${i + 1}. [${f.severity.toUpperCase()}] ${f.category}: ${f.claim}`;
      if (f.evidence) line += `\n   Evidence: ${f.evidence}`;
      if (f.suggestion) line += `\n   Suggested fix: ${f.suggestion}`;
      return line;
    })
    .join('\n\n');

  const cwd = resolveWorkspaceRoot();
  const planPath = planFilePath(id);
  const prompt = buildRevisePrompt(planPath, findingsBlock);

  const mma = await buildMmaClient({ db });
  const batchRowId = await dispatchAndRegister({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'plan-audit-apply',
    cwd,
    body: {
      prompt,
      reviewPolicy: 'none',
    },
    actorId: guard.memberId,
    meta: { passNo, findingsCount: findings.length },
  });

  return NextResponse.json({ batchId: batchRowId, findingsCount: findings.length }, { status: 202 });
}
