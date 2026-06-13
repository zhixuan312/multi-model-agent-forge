/**
 * Client-safe Plan-stage view types. Kept separate from `plan.ts` (which reads +
 * parses the plan markdown with `node:fs`) so the client island can `import type`
 * these without pulling `fs` into the browser bundle.
 */

export interface PlanTaskSeed {
  id: string; // 't8'
  num: number; // 8
  title: string;
  /** The FULL task markdown from the plan — Files, TDD steps, code blocks, commit. */
  body: string;
  files: string[];
  dependsOn: string[]; // ['Task 1', 'Task 2']
  targetRepo: string;
}

export interface PlanPhaseSeed {
  id: string;
  title: string;
  tasks: PlanTaskSeed[];
}

export interface PlanAuditFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  claim: string;
}
