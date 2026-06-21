/**
 * Client-safe Plan-stage view types. Kept separate from `plan.ts` (which reads +
 * parses the plan markdown with `node:fs`) so the client island can `import type`
 * these without pulling `fs` into the browser bundle.
 */

export interface PlanTaskSeed {
  id: string;
  num: number;
  title: string;
  body: string;
  files: string[];
  dependsOn: string[];
  targetRepo: string;
  /** DB status — used to initialize approval state on page load. */
  dbStatus?: string;
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
  evidence?: string;
  suggestion?: string;
}
