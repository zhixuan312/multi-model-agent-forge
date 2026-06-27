import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardBuildWrite } from '@/build/guard';
import { readPlanFileAsync } from '@/projects/project-files';
import { parsePlanSections } from '@/plan/plan-file-ops';
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

function buildRevisePrompt(taskTitle: string, findingsBlock: string, taskBody: string): { system: string; user: string } {
  const system = `Role: You are a plan task reviser for Forge, a collaborative SDLC platform. You revise individual implementation tasks based on audit findings.

Task: Revise the given plan task to address every audit finding listed. For each finding, incorporate the suggested fix using the cited evidence to locate the relevant passage. Return the FULL revised task body — not a diff.

Constraints:
- Address each finding's claim — use the evidence to find the exact passage and the suggestion as guidance
- Maintain the task's TDD structure (Files, Steps, test code, implementation code, run commands)
- Do NOT add unrelated changes beyond what the findings require
- Do NOT add task headings (### or ##) — headings are managed externally
- Preserve all content not touched by a finding
- Use checkbox syntax (\`- [ ]\`) for steps

Output format:
Return a JSON object with exactly one field:
\`\`\`json
{ "draftMd": "<the full revised task body markdown>" }
\`\`\``;

  const user = `Context: This is the "${taskTitle}" task from an implementation plan. An audit pass flagged findings that affect this task.

Input:

--- Current Task Body ---
${taskBody}
--- End Task Body ---

--- Audit Findings to Address ---
${findingsBlock}
--- End Findings ---`;

  return { system, user };
}

function matchFindingsToTasks(
  findings: Finding[],
  tasks: Array<{ heading: string; body: string }>,
): Map<number, Finding[]> {
  const result = new Map<number, Finding[]>();

  for (const f of findings) {
    const evidence = (f.evidence ?? '').replace(/^"/, '').replace(/"$/, '');
    if (evidence.length < 20) continue;
    const matched = new Set<number>();

    for (let ti = 0; ti < tasks.length; ti++) {
      const text = tasks[ti].body;
      for (let start = 0; start < Math.min(evidence.length, 300); start += 30) {
        const frag = evidence.slice(start, start + 40);
        if (frag.length > 15 && text.includes(frag)) {
          matched.add(ti);
          break;
        }
      }
    }

    // If no evidence match, try matching by task title in the claim
    if (matched.size === 0) {
      for (let ti = 0; ti < tasks.length; ti++) {
        const title = tasks[ti].heading.replace(/^###\s*/, '');
        if (f.claim.includes(title) || (f.evidence && f.evidence.includes(title))) {
          matched.add(ti);
        }
      }
    }

    for (const idx of matched) {
      const list = result.get(idx) ?? [];
      list.push(f);
      result.set(idx, list);
    }
  }

  return result;
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

  const planFile = await readPlanFileAsync(id);
  if (!planFile) {
    return NextResponse.json({ error: 'No plan.md found.' }, { status: 409 });
  }

  const tasks = parsePlanSections(planFile.bodyMd);
  const taskFindings = matchFindingsToTasks(parsed.data.findings, tasks);

  if (taskFindings.size === 0) {
    return NextResponse.json({ error: 'No findings matched any task.' }, { status: 422 });
  }

  const mma = await buildMmaClient({ db });
  const cwd = resolveWorkspaceRoot();
  const batchIds: string[] = [];

  for (const [taskIdx, findings] of taskFindings) {
    const task = tasks[taskIdx];
    const title = task.heading.replace(/^###\s*/, '').trim();

    const findingsBlock = findings
      .map((f, i) => {
        let line = `${i + 1}. [${f.severity.toUpperCase()}] ${f.category}: ${f.claim}`;
        if (f.evidence) line += `\n   Evidence: ${f.evidence}`;
        if (f.suggestion) line += `\n   Suggested fix: ${f.suggestion}`;
        return line;
      })
      .join('\n\n');

    const { system, user } = buildRevisePrompt(title, findingsBlock, task.body);

    const batchRowId = await dispatchAndRegister({
      db,
      mma,
      projectId: id,
      route: 'orchestrate',
      handler: 'plan-audit-apply',
      cwd,
      body: {
        prompt: `${system}\n\n${user}`,
        reviewPolicy: 'none',
      },
      actorId: guard.memberId,
      meta: { taskTitle: title, taskIdx },
    });
    batchIds.push(batchRowId);
  }

  return NextResponse.json({ batchIds, tasksToRevise: taskFindings.size }, { status: 202 });
}
