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
});

type Finding = z.infer<typeof findingSchema>;

const REVISE_SYSTEM = `You are Forge's spec reviser. You receive ONE section of a specification and audit findings that affect it. Revise the section to address every finding.

Rules:
- Return the FULL revised section content (not a diff).
- Address each finding's claim using the evidence and suggested fix as guidance.
- Maintain the original tone, format, and level of detail.
- Do NOT add unrelated changes beyond what the findings require.
- Do NOT add section headings — they are managed externally.

Return a JSON object: { "draftMd": "..." }`;

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

    const userPrompt = [
      `# Section: ${section.label} (componentKind: ${kind}, sectionKey: ${key})`,
      '',
      section.draftMd ?? '(empty)',
      '',
      '# Findings to address',
      findingsBlock,
    ].join('\n');

    const handlerKey = `spec-audit-apply:${kind}/${key}`;
    const batchRowId = await dispatchAndRegister({
      db,
      mma,
      projectId: id,
      route: 'orchestrate',
      handler: 'spec-audit-apply',
      cwd,
      body: {
        prompt: `${REVISE_SYSTEM}\n\n${userPrompt}`,
        reviewPolicy: 'none',
      },
      actorId: guard.memberId,
      meta: { componentKind: kind, sectionKey: key, actorId: guard.memberId, totalSections: sectionFindings.size },
    });
    batchIds.push(batchRowId);
  }

  return NextResponse.json({ batchIds, sectionsToRevise: sectionFindings.size }, { status: 202 });
}
