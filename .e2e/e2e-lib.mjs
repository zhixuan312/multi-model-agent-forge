// Shared E2E harness lib for the Forge auto-completion loop.
// Usage: import { reset, mintSession, startAuto, snapshot } from './e2e-lib.mjs'
import postgres from 'postgres';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DB = 'postgresql://postgres:REDACTED_ROTATED@100.117.229.27/postgres';
export const PID = '97801cb6-8d2c-4745-b3bb-b7166053a758';
export const MEMBER = '3ba973d8-fe06-4294-b963-5b77ce9653bc'; // xuan
export const REPO = '/Users/zhangzhixuan/Documents/code/mma-parent/multi-model-agent-forge/.forge-workspace/self_service_demo';
export const BASE = 'http://localhost:3000';

/** Reset the project details to the baseline + put the target repo on a clean
 * master + fail any orphaned in-flight batches. Returns a short summary. */
export async function reset() {
  const sql = postgres(DB);
  try {
    const [row] = await sql`select details, details_version from forge.project where id=${PID}`;
    const d = row.details;
    const spec = d.stages.spec;
    spec.status = 'active'; delete spec.completedAt;
    // Craft done = finalize not yet started: clear BOTH the passes and the sign-off
    // so the resolver opens at spec audit pass 1 (not a leftover mid-finalize pass).
    spec.phases.finalize.status = 'active'; spec.phases.finalize.approvals = []; spec.phases.finalize.auditPasses = [];
    const plan = d.stages.plan; plan.status = 'pending'; delete plan.startedAt; delete plan.completedAt;
    plan.phases.refine.status = 'pending'; plan.phases.refine.file = null; plan.phases.refine.attempts = []; plan.phases.refine.tasks = [];
    plan.phases.validate.status = 'pending'; plan.phases.validate.auditPasses = [];
    const ex = d.stages.execute; ex.status = 'pending'; delete ex.startedAt; delete ex.completedAt; ex.phases.configure.repos = []; ex.phases.implement.repos = [];
    const rv = d.stages.review; rv.status = 'pending'; delete rv.startedAt; delete rv.completedAt; rv.phases.review.repos = [];
    const jn = d.stages.journal; jn.status = 'pending'; delete jn.startedAt; delete jn.completedAt; jn.phases.journal.attempts = []; jn.phases.journal.learnings = []; jn.phases.summary.attempts = [];
    d.automation = { status: 'off' };
    // Project-level event log (never cleared): seed the explore->craft history that
    // already completed, so auto-mode shows the FULL timeline from explore onward.
    // Milestones carry their real measured duration; the 8 component approvals are
    // instantaneous (no duration). Timestamps mirror the real batch timings.
    const COMP = [
      ['Context', '2026-07-02T12:55:30.000Z'],
      ['Problem statement', '2026-07-02T12:55:42.000Z'],
      ['Goals & Requirements', '2026-07-02T12:55:54.000Z'],
      ['Alternatives', '2026-07-02T12:56:06.000Z'],
      ['Technical Design', '2026-07-02T12:56:18.000Z'],
      ['Testing Plan', '2026-07-02T12:56:30.000Z'],
      ['Risks', '2026-07-02T12:56:42.000Z'],
      ['User Stories & Tasks', '2026-07-02T12:56:54.000Z'],
    ];
    d.events = [
      { stage: 'exploration', phase: 'discover', detail: 'Proposed exploration tasks', kind: 'done', durationMs: 34000, at: '2026-07-02T12:35:30.749Z' },
      { stage: 'exploration', phase: 'synthesize', detail: 'Synthesized exploration brief', kind: 'done', durationMs: 119000, at: '2026-07-02T12:47:10.018Z' },
      { stage: 'spec', phase: 'craft', detail: 'Drafted spec', kind: 'done', durationMs: 357000, at: '2026-07-02T12:49:21.238Z' },
      ...COMP.map(([label, at]) => ({ stage: 'spec', phase: 'craft', detail: `xuan approved component: ${label}`, kind: 'done', at })),
    ];
    await sql`update forge.project set details=${sql.json(d)}, details_version=${row.details_version + 1}, current_stage='spec', phase='design', auto_mode=false, auto_note=null, completed_at=null, updated_at=now() where id=${PID}`;
    const upd = await sql`update forge.ops_mma_batch set status='failed', terminal_at=now(), result=${sql.json({ error: { code: 'reset', message: 'cleared' } })} where project_id=${PID} and status in ('dispatched','running') returning id`;
    // Clean baseline for the target repo — always branch from master.
    try {
      execFileSync('git', ['-C', REPO, 'checkout', '-f', 'master'], { timeout: 30000, stdio: 'pipe' });
      execFileSync('git', ['-C', REPO, 'reset', '--hard', 'origin/master'], { timeout: 30000, stdio: 'pipe' });
    } catch (e) { /* best-effort repo reset */ }
    const headSha = execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    return { clearedInflight: upd.length, repoHead: headSha };
  } finally { await sql.end(); }
}

/** Insert a session row for `xuan` and return the raw cookie token. */
export async function mintSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sql = postgres(DB);
  try {
    await sql`insert into forge.team_session (member_id, token_hash, expires_at, last_used_at) values (${MEMBER}, ${tokenHash}, ${new Date(Date.now() + 30 * 86400000)}, ${new Date()})`;
  } finally { await sql.end(); }
  return token;
}

/** Start auto via the unified endpoint: POST /transition { action: 'start_auto' }. */
export async function startAuto(token) {
  const res = await fetch(`${BASE}/api/projects/${PID}/transition`, {
    method: 'POST',
    headers: { cookie: `forge_session=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start_auto' }),
  });
  return { status: res.status, body: await res.text().catch(() => '') };
}

/** One full snapshot across DB layers. */
export async function snapshot() {
  const sql = postgres(DB);
  try {
    const [p] = await sql`select current_stage, phase, auto_mode, auto_note, completed_at, details from forge.project where id=${PID}`;
    const batches = await sql`select id, handler, status, batch_id, created_at, terminal_at, result from forge.ops_mma_batch where project_id=${PID} order by created_at asc`;
    const d = p.details;
    const stageStatus = Object.fromEntries(Object.entries(d.stages).map(([k, v]) => [k, v.status]));
    const events = (d.events ?? []).map(s => ({ kind: s.kind ?? 'action', detail: s.detail, stage: s.stage, at: s.at }));
    const inflight = batches.filter(b => b.status === 'dispatched' || b.status === 'running');
    return {
      currentStage: p.current_stage, phase: p.phase, autoMode: p.auto_mode, autoNote: p.auto_note,
      completedAt: p.completed_at, stageStatus, events,
      batches: batches.map(b => ({ h: b.handler, s: b.status, id: (b.batch_id || '').slice(0, 8), err: b.result?.error?.message?.slice(0, 80) })),
      inflightCount: inflight.length,
    };
  } finally { await sql.end(); }
}
