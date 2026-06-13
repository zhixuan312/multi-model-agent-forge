import { mockPlan } from '@/mock/domains/projects/plan';

/**
 * Execute-stage mock. The locked plan is handed to MMA execute-plan, which runs
 * each task one-by-one. We reuse the parsed plan (same doc as the Plan stage) as
 * the execution units; the live run (queued → running → done, branch + commit) is
 * simulated client-side in ExecuteStageClient. Server-only (mockPlan reads fs).
 */

export interface ExecUnit {
  id: string;
  num: number;
  title: string;
  repo: string;
  dependsOn: string[];
  filesCount: number;
}

export function mockExecute(projectId: string): {
  projectName: string;
  planVersion: number;
  mmaReady: boolean;
  units: ExecUnit[];
  writeTargets: string[];
} {
  const plan = mockPlan(projectId);
  const units: ExecUnit[] = plan.phases
    .flatMap((p) => p.tasks)
    .map((t) => ({
      id: t.id,
      num: t.num,
      title: t.title,
      repo: t.targetRepo,
      dependsOn: t.dependsOn,
      filesCount: t.files.length,
    }));
  const writeTargets = [...new Set(units.map((u) => u.repo).filter((r) => r !== 'monorepo'))];
  return { projectName: plan.projectName, planVersion: 1, mmaReady: plan.mmaReady, units, writeTargets };
}
