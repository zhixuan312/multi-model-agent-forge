import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findMockProject } from '@/mock/domains/projects/dashboard';
import type { PlanPhaseSeed, PlanTaskSeed, PlanAuditFinding } from '@/mock/domains/projects/plan-types';

export type { PlanPhaseSeed, PlanTaskSeed, PlanAuditFinding } from '@/mock/domains/projects/plan-types';

/**
 * Plan-stage mock, sampled from the REAL implementation plan at
 * src/mock/data/unified-task-api-plan.md (a copy of the writing-plans-skill
 * output). The plan is parsed in full — every task keeps its complete body
 * (Files, TDD steps, code blocks, commit) so Detail shows the whole task, not a
 * summary. Server-only (uses node:fs); the client imports types from plan-types.
 */

const DOC_PATH = join(process.cwd(), 'src/mock/data/unified-task-api-plan.md');

interface ParsedDoc {
  intentMd: string;
  fullMd: string;
  phases: PlanPhaseSeed[];
}

let _cache: ParsedDoc | null = null;

function parseDoc(): ParsedDoc {
  if (_cache) return _cache;
  const fullMd = readFileSync(DOC_PATH, 'utf-8');
  const lines = fullMd.split('\n');

  const goalLine = lines.find((l) => l.startsWith('**Goal:**'));
  const intentMd = goalLine
    ? goalLine.replace('**Goal:**', '').trim()
    : 'Replace the per-route handlers with a single POST /task endpoint.';

  const phases: PlanPhaseSeed[] = [];
  let phase: PlanPhaseSeed | null = null;
  let task: { id: string; num: number; title: string; body: string[] } | null = null;

  const flush = () => {
    if (phase && task) phase.tasks.push(buildTask(task.id, task.num, task.title, task.body.join('\n').trim()));
    task = null;
  };

  for (const line of lines) {
    const ph = /^## Phase \d+\s*[—-]\s*(.+)$/.exec(line);
    if (ph) {
      flush();
      phase = { id: `p${phases.length + 1}`, title: ph[1].trim(), tasks: [] };
      phases.push(phase);
      continue;
    }
    const tk = /^### Task (\d+):\s*(.+)$/.exec(line);
    if (tk) {
      flush();
      task = { id: `t${tk[1]}`, num: Number(tk[1]), title: tk[2].trim(), body: [] };
      continue;
    }
    // Skip the `---` rule that separates tasks.
    if (task && line.trim() !== '---') task.body.push(line);
  }
  flush();

  _cache = { intentMd, fullMd, phases };
  return _cache;
}

/** Pull Files + Depends-on + the target package from a task's preamble (pre-steps). */
function buildTask(id: string, num: number, title: string, body: string): PlanTaskSeed {
  const preamble = body.split(/\n- \[ \]|\n\*\*Step/)[0];
  const files = [...preamble.matchAll(/^- (?:Create|Test|Modify|Delete):\s*`([^`]+)`/gm)].map((m) => m[1]);
  const depLine = /- Depends on:\s*(.+)/.exec(preamble);
  const dependsOn = depLine ? [...depLine[1].matchAll(/Tasks?\s+(\d+)/g)].map((m) => `Task ${m[1]}`) : [];
  const core = files.filter((f) => f.includes('packages/core')).length;
  const server = files.filter((f) => f.includes('packages/server')).length;
  const targetRepo = server > core ? 'packages/server' : core > 0 ? 'packages/core' : 'monorepo';
  return { id, num, title, body, files, dependsOn, targetRepo };
}

// Plan audit — two passes referencing the real plan: pass 1 has a high (revised), pass 2 clears to low (clean).
const AUDIT_ROUNDS: PlanAuditFinding[][] = [
  [
    { severity: 'high', category: 'sequencing', claim: 'Tasks 13–15 delete the old handlers/batch/config, but the goldens (Task 18) only update after — the suite is red across all of Phase 4 with no interim green checkpoint.' },
    { severity: 'medium', category: 'testability', claim: 'Task 6 ships a placeholder test that asserts `true === true` — it can’t fail, so the session-id work isn’t really TDD.' },
    { severity: 'medium', category: 'coverage', claim: 'Task 12 names the enrichment hooks but no task covers the research Brave-API-unavailable failure path.' },
    { severity: 'low', category: 'tdd', claim: 'Task 11 (skill files) has no failing-test step — stub content is never verified by the loader.' },
    { severity: 'low', category: 'paths', claim: 'Task 19 says “any that reference per-route endpoints” without naming the SKILL.md files — under-specified.' },
  ],
  [{ severity: 'low', category: 'tooling', claim: 'Task 20’s sweep still lacks the explicit `ts-prune` invocation in its first step.' }],
];

export function mockPlan(projectId: string): {
  projectName: string;
  intentMd: string;
  phase: 'design' | 'build' | 'done';
  mmaReady: boolean;
  phases: PlanPhaseSeed[];
  planMd: string;
  auditRounds: PlanAuditFinding[][];
} {
  const proj = findMockProject(projectId);
  const { intentMd, phases, fullMd } = parseDoc();
  return {
    projectName: proj?.name ?? 'Unified Task API',
    intentMd,
    phase: 'design',
    mmaReady: true,
    phases,
    planMd: fullMd,
    auditRounds: AUDIT_ROUNDS,
  };
}
