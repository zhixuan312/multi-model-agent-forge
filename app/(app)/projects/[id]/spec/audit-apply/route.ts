import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { loadOutline } from '@/spec/spec-core';
import { stage } from '@/db/schema/projects';
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

type Finding = z.infer<typeof findingSchema>;

function buildRevisePrompt(sectionLabel: string, sectionKind: string, findingsBlock: string, sectionDraft: string): { system: string; user: string } {
  const system = `Role: You are a specification reviser for Forge, a collaborative SDLC platform. You specialize in addressing audit findings by making precise, targeted edits to specification sections.

Task: Revise the given section to address every audit finding listed. For each finding, incorporate the suggested fix using the cited evidence to locate the relevant passage. Return the FULL revised section — not a diff, not a summary.

Constraints:
- Address each finding's claim — use the evidence to find the exact passage and the suggestion as guidance for the fix
- Maintain the original tone, format, and level of detail — the revision should read as if the section was always written this way
- Do NOT add unrelated improvements, rewrites, or content beyond what the findings require
- Do NOT add section headings (## or #) — headings are managed externally
- Preserve all content that is not touched by a finding — only modify what a finding targets
- Write in proper markdown: ### subheadings, **bold** for key terms, bullet lists, \`code\` for technical names, tables for comparisons

Output format:
Return a JSON object with exactly one field:
\`\`\`json
{ "draftMd": "<the full revised section markdown>" }
\`\`\`
- draftMd contains the COMPLETE section content after all findings are applied
- Do NOT wrap the JSON in markdown code fences`;

  const user = `Context: This is the "${sectionLabel}" section (${sectionKind}) of a project specification. An audit pass flagged the findings below. Your job is to revise this section so the findings no longer apply.

Input:

--- Current Section Draft ---
${sectionDraft}
--- End Section Draft ---

--- Audit Findings to Address ---
${findingsBlock}
--- End Findings ---`;

  return { system, user };
}

function matchFindingsToSections(
  findings: Finding[],
  sections: Array<{ kind: string; key: string; label: string; draftMd: string | null }>,
): Map<string, Finding[]> {
  const result = new Map<string, Finding[]>();

  for (const f of findings) {
    const evidence = (f.evidence ?? '').replace(/^"/, '').replace(/"$/, '');
    if (evidence.length < 20) continue;
    const matched = new Set<string>();

    for (const s of sections) {
      const text = s.draftMd ?? '';
      for (let start = 0; start < Math.min(evidence.length, 300); start += 30) {
        const frag = evidence.slice(start, start + 40);
        if (frag.length > 15 && text.includes(frag)) {
          matched.add(`${s.kind}/${s.key}`);
          break;
        }
      }
    }

    for (const key of matched) {
      const list = result.get(key) ?? [];
      list.push(f);
      result.set(key, list);
    }
  }

  return result;
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

  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, id), eq(stage.kind, 'spec')))
    .limit(1);
  if (!specStage) {
    return NextResponse.json({ error: 'No spec stage.' }, { status: 409 });
  }

  const components = await loadOutline(db, specStage.id);
  const allSections = components.flatMap((c) =>
    c.sections.map((s) => ({ kind: c.kind, key: s.key, label: s.label, draftMd: s.draftMd })),
  );

  const sectionFindings = matchFindingsToSections(parsed.data.findings, allSections);

  if (sectionFindings.size === 0) {
    return NextResponse.json({ error: 'No findings matched any section.' }, { status: 422 });
  }

  // Build per-section revision prompts, dispatch each as a separate MMA call
  const mma = await buildMmaClient({ db });
  const cwd = resolveWorkspaceRoot();
  const batchIds: string[] = [];

  for (const [sectionKey, findings] of sectionFindings) {
    const [kind, key] = sectionKey.split('/');
    const section = allSections.find((s) => s.kind === kind && s.key === key);
    if (!section) continue;

    const findingsBlock = findings
      .map((f, i) => {
        let line = `${i + 1}. [${f.severity.toUpperCase()}] ${f.category}: ${f.claim}`;
        if (f.evidence) line += `\n   Evidence: ${f.evidence}`;
        if (f.suggestion) line += `\n   Suggested fix: ${f.suggestion}`;
        return line;
      })
      .join('\n\n');

    const { system, user } = buildRevisePrompt(section.label, `${kind}/${key}`, findingsBlock, section.draftMd ?? '(empty)');

    const batchRowId = await dispatchAndRegister({
      db,
      mma,
      projectId: id,
      route: 'orchestrate',
      handler: 'spec-audit-apply',
      cwd,
      body: {
        prompt: `${system}\n\n${user}`,
        reviewPolicy: 'none',
      },
      actorId: guard.memberId,
      meta: { componentKind: kind, sectionKey: key, actorId: guard.memberId, totalSections: sectionFindings.size, passNo: parsed.data.passNo },
    });
    batchIds.push(batchRowId);
  }

  return NextResponse.json({ batchIds, sectionsToRevise: sectionFindings.size }, { status: 202 });
}
