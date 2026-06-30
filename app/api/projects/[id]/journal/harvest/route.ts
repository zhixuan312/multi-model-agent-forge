import { NextResponse, type NextRequest } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { assertProjectReadable, ProjectAccessError, getProject } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { qaMessage } from '@/db/schema/spec';
import { stage } from '@/db/schema/projects';
import { readExplorationSummaryAsync, readSpecFileAsync, readPlanFileAsync } from '@/projects/project-files';
import { journalFilePath } from '@/projects/project-files';
import { buildMmaClient } from '@/mma/server-client';
import { dispatchAndRegister, findInflight } from '@/dispatch/dispatch-helpers';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
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

  // ── Gather ALL project artifacts from physical files (source of truth) ──

  const sections: string[] = [];
  sections.push(`# Project: ${proj.name}`);
  if (proj.intentMd) sections.push(`## Intent\n${proj.intentMd}`);

  // 1. Exploration (physical file)
  const explorationMd = await readExplorationSummaryAsync(id);
  if (explorationMd) sections.push(`## Exploration\n${explorationMd.slice(0, 6000)}`);

  // 2. Spec (physical file)
  const specFile = await readSpecFileAsync(id);
  if (specFile) sections.push(`## Specification\n${specFile.bodyMd.slice(0, 8000)}`);

  // 3. Plan (physical file)
  const planFile = await readPlanFileAsync(id);
  if (planFile) sections.push(`## Plan\n${planFile.bodyMd.slice(0, 8000)}`);

  // 4. Execute results (from batch)
  const batches = await db.select({ route: mmaBatch.route, result: mmaBatch.result })
    .from(mmaBatch).where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.status, 'done'))).orderBy(desc(mmaBatch.createdAt));
  const executeBatch = batches.find((b) => b.route === 'execute_plan');
  if (executeBatch?.result) {
    const env = executeBatch.result as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
    sections.push(`## Execute Results\n${summary.slice(0, 4000)}`);
  }

  // 5. Review results (from batch)
  const reviewBatch = batches.find((b) => b.route === 'review');
  if (reviewBatch?.result) {
    const env = reviewBatch.result as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
    sections.push(`## Review Findings\n${summary.slice(0, 4000)}`);
  }

  // 6. Discussions across all stages (spec + plan conversations)
  try {
    const discussions = await db.select({ bodyMd: qaMessage.bodyMd, sender: qaMessage.sender })
      .from(qaMessage)
      .innerJoin(stage, eq(qaMessage.stageId, stage.id))
      .where(eq(stage.projectId, id))
      .orderBy(qaMessage.createdAt);
    if (discussions.length > 0) {
      const convo = discussions.slice(-50).map((d) =>
        `[${d.sender}] ${(d.bodyMd ?? '').slice(0, 200)}`
      ).join('\n');
      sections.push(`## Conversations & Discussions\n${convo}`);
    }
  } catch { /* qa_message may not exist for all projects */ }

  // 7. Audit findings (spec + plan audits)
  const auditBatches = batches.filter((b) => b.route === 'audit').slice(0, 3);
  if (auditBatches.length > 0) {
    const auditSummaries = auditBatches.map((b) => {
      const env = b.result as Record<string, unknown>;
      const output = (env?.output ?? {}) as Record<string, unknown>;
      const summary = typeof output.summary === 'string' ? output.summary : JSON.stringify(output.summary ?? {});
      return summary.slice(0, 2000);
    }).join('\n---\n');
    sections.push(`## Audit Findings\n${auditSummaries}`);
  }

  const journalPath = journalFilePath(id);

  const prompt = `Role: You are the learning harvester for Forge, a software delivery harness. You build the team's collective knowledge base — the journal that shapes how AI agents and team members think, decide, and assess risk on future projects.

Task: Analyze the project artifacts below and extract 10-20 learnings in two tiers: domain-specific (tied to this project's technology and problem space) and generic (universal principles any team could apply). Write them to \`${journalPath}\`.

Context: This project completed all 6 stages: Exploration → Spec → Plan → Execute → Review → Journal. The artifacts include physical documents, execution results, review findings, team discussions, and audit passes. The journal is the team's capability store — it captures how the team should BEHAVE, THINK, and KNOW so that every future project benefits from this one. In the AI era, the journal is how the team transfers judgment, not just information.

Input:

${sections.join('\n\n')}

Constraints:
- Extract learnings in TWO tiers:
  **Domain-specific** — tied to this project's technology, APIs, libraries, or problem domain. Another project in the same domain would need these. Example: "PostgreSQL JSONB queries silently return empty on type mismatch — always cast filter values explicitly."
  **Generic** — universal team principles that apply regardless of domain. These shape judgment and process. Example: "When the audit finds the plan references symbols that don't exist in the baseline, re-run the spec against the live codebase before re-planning."

- Cover ALL 6 categories — do not cluster:
  - **Decision** — a trade-off the team made and WHY the alternative was rejected. Frame as: "When X vs Y, choose X because Z."
  - **Design** — an architecture, seam, or contract insight. Frame as: "The boundary between A and B should be drawn at C because D."
  - **Behavior** — a runtime surprise, edge case, or default that matters. Frame as: "System X does Y when Z — handle it by W."
  - **Process** — what accelerated or slowed the workflow. Frame as: "Do X before Y — skipping it caused Z."
  - **Knowledge** — a technical fact the team didn't know before. Frame as: "X works like Y (not like Z as assumed)."
  - **Style** — a naming, formatting, or convention choice with rationale. Frame as: "Name X as Y because Z."

- Each learning is a concrete, actionable principle — NOT a description of what was done
- Frame for future use: "When [situation], do [action] because [reason]"
- Mine the conversations and audit findings — they contain the sharpest insights (disagreements, corrections, surprises)
- Deduplicate: if multiple sources surface the same insight, merge into one learning
- Mark each learning as domain-specific or generic

Output format:
Write the ENTIRE learning set to \`${journalPath}\` using this exact markdown structure. Every learning MUST follow the standardized 6-field entry format:

## Category (e.g. "Decision")

### When [situation], [action] because [reason]

**Principle:** One-sentence actionable rule that a team member or AI agent can apply without reading the evidence.

**Evidence:** What happened in THIS project — the specific event, audit finding, review comment, or conversation that surfaced this. Be concrete: name the file, the error, the discussion point.

**Risk if ignored:** What goes wrong if a future team skips this — the cost of not knowing. Be specific: "silent data loss", "wasted audit cycle", "PR rejected by reviewer".

**Confidence:** One of:
- First signal — observed once in this project, plausible but unproven
- Recurring pattern — seen across multiple stages or confirmed by audit
- Hard-won lesson — caused a real failure, rollback, or significant rework

**Tier:** Domain-specific OR Generic
**Source:** Exploration | Spec | Plan | Execute | Review
**Tags:** keyword1, keyword2

Rules for the structure:
- Group learnings under ## category headings (Decision, Design, Behavior, Process, Knowledge, Style)
- Use ### for each learning — the heading IS the principle in "When X, do Y because Z" form
- Every field is MANDATORY — no empty fields, no "N/A"
- Evidence must reference this project specifically, not generic advice
- Risk must be a concrete consequence, not "things might go wrong"
Write the file to \`${journalPath}\`. This is MANDATORY — the harness reads learnings from that file.`;

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
