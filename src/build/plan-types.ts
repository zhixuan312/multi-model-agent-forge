/**
 * Client-safe Plan-stage view types. Kept separate from file-system modules
 * so the client island can `import type` without pulling `fs` into the bundle.
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
  /** Track/phase this task belongs to. */
  phase?: string;
  /** Member IDs who approved this task. */
  approvedBy?: string[];
  /** Member IDs invited to review this task. */
  participantIds?: string[];
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
