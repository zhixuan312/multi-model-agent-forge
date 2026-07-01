import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { specFilePath } from '@/projects/project-files';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchMma, findInflight } from '@/dispatch/dispatch-helpers';
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

function buildRevisePrompt(filePath: string, findingsBlock: string): string {
  return `Role: You are a specification reviser for Forge, a software delivery harness.

Task: Read the specification at \`${filePath}\`, apply every audit finding listed below, and write the revised specification back to the SAME file.

Constraints:
- Address EVERY finding — use the evidence to locate the exact passage and the suggestion as guidance
- Preserve the spec structure: # title, ## component headings, ### section headings, bullet lists, tables, code blocks
- Do NOT add or remove ## or ### sections — only revise content within existing sections
- Do NOT rename section headings — they are stable keys used by the harness
- Maintain the original tone, format, and level of detail
- Preserve all content not touched by a finding — only modify what a finding targets
- Write the FULL revised specification back to \`${filePath}\` — not a diff, the complete file

Findings to address:

${findingsBlock}`;
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const db = getDb();

  const existing = await findInflight(db, id, 'spec-audit-apply');
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
  const filePath = specFilePath(id);
  const prompt = buildRevisePrompt(filePath, findingsBlock);

  const mma = await buildMmaClient({ db });
  const { batchRowId } = await dispatchMma({
    db,
    mma,
    projectId: id,
    route: 'orchestrate',
    handler: 'spec-audit-apply',
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
