import { MmaClient } from '@/mma/client';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';

/**
 * Build review (Spec 7 §Review; the 7b advisory pass). Per write-target repo, run
 * MMA `review` over the changed code, then DERIVE the binary verdict — MMA emits
 * findings, not a verdict (`structuredReport.findingsOutcome` + severity-tagged
 * findings; no `verdict` field). Forge rule: `changes_required` iff ≥1
 * critical/high finding, else `approved`. Review is ADVISORY — it never blocks
 * `done`; a review batch failure → `verdict:'error'` and the pipeline proceeds.
 */

export type ReviewVerdict = 'approved' | 'changes_required' | 'error';

export interface ReviewResult {
  repo: string;
  verdict: ReviewVerdict;
  findingsCount: number;
}

interface ParsedReview {
  findingsCount: number;
  hasCriticalOrHigh: boolean;
  missing: boolean;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/**
 * Parse a review terminal envelope (v5.4+) → finding count + critical/high gate.
 * New shape: { task, output: { summary }, error }.
 * The summary is the refined reviewer output which may contain findings.
 */
export function parseReviewEnvelope(envelope: unknown): ParsedReview {
  const env = asObj(envelope);
  const task = asObj(env.task);
  const output = asObj(env.output);
  const error = env.error ? asObj(env.error) : null;

  if (task.status === 'failed' || error) {
    return { findingsCount: 0, hasCriticalOrHigh: false, missing: true };
  }

  // output.summary is the refined reviewer output — parse findings from it
  const summary = output.summary;
  let findings: Record<string, unknown>[] = [];

  if (summary && typeof summary === 'object') {
    const summaryObj = asObj(summary);
    if (Array.isArray(summaryObj.findings)) {
      findings = summaryObj.findings.map((f) => asObj(f));
    }
  }

  if (findings.length === 0) {
    return { findingsCount: 0, hasCriticalOrHigh: false, missing: false };
  }

  const hasCriticalOrHigh = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  return { findingsCount: findings.length, hasCriticalOrHigh, missing: false };
}

/** Derive the binary verdict from a parsed review (Spec 7 F4). */
export function deriveVerdict(parsed: ParsedReview): ReviewVerdict {
  if (parsed.missing) return 'error';
  return parsed.hasCriticalOrHigh ? 'changes_required' : 'approved';
}

export interface RunReviewDeps {
  mma: MmaClient;
  bus?: ProjectEventBus;
  pollIntervalMs?: number;
}

/**
 * Review ONE repo's changes. Dispatches `review` (filePaths = the changed files),
 * polls to terminal, derives the verdict, emits `review.done`. On any error the
 * verdict is `'error'` (advisory — never throws to block the pipeline).
 */
export async function reviewRepo(
  deps: RunReviewDeps,
  args: { projectId: string; repoName: string; repoCwd: string; changedFiles: string[] },
): Promise<ReviewResult> {
  const bus = deps.bus ?? projectEventBus;
  let result: ReviewResult;
  try {
    const { batchId } = await deps.mma.review(args.repoCwd, {
      paths: args.changedFiles.length > 0 ? args.changedFiles : undefined,
      inline: args.changedFiles.length > 0 ? undefined : '// no file list — review the working tree',
    });
    const envelope = await pollToTerminal(deps.mma, batchId, deps.pollIntervalMs ?? 25);
    const parsed = parseReviewEnvelope(envelope);
    const verdict = deriveVerdict(parsed);
    result = { repo: args.repoName, verdict, findingsCount: parsed.findingsCount };
  } catch {
    result = { repo: args.repoName, verdict: 'error', findingsCount: 0 };
  }
  bus.publish(args.projectId, {
    type: 'review.done',
    repo: result.repo,
    verdict: result.verdict,
    findingsCount: result.findingsCount,
  });
  return result;
}

async function pollToTerminal(mma: MmaClient, batchId: string, intervalMs: number): Promise<unknown> {
  for (;;) {
    const r = await mma.poll(batchId);
    if (r.state === 'terminal') return r.envelope;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
