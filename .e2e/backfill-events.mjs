// Backfill details.events for a completed project from its REAL batch ledger +
// details (approvals/learnings), using the same labels/durations/pass-numbering
// as the live activity-log model. Usage: node .e2e/backfill-events.mjs <projectId>
import postgres from 'postgres';
const DB = 'postgresql://postgres:REDACTED_ROTATED@100.117.229.27/postgres';
const PID = process.argv[2] || '02378477-1808-4f45-9b3c-35ba8e0b5d38';
const FORGE = '00000000-0000-0000-0000-000000000000';

const HANDLER = {
  'explore-propose': ['exploration', 'discover', 'Proposed exploration tasks'],
  'explore-synthesize': ['exploration', 'synthesize', 'Synthesized exploration brief'],
  'spec-auto-draft': ['spec', 'craft', 'Drafted spec'],
  'spec-refine': ['spec', 'craft', 'Refined spec component'],
  'spec-audit': ['spec', 'finalize', 'Audited spec'],
  'spec-audit-apply': ['spec', 'finalize', 'Applied spec audit findings'],
  'plan-author': ['plan', 'refine', 'Authored plan'],
  'plan-refine': ['plan', 'refine', 'Refined plan task'],
  'plan-audit': ['plan', 'validate', 'Audited plan'],
  'plan-audit-apply': ['plan', 'validate', 'Applied plan audit findings'],
  'execute-pipeline': ['execute', 'implement', 'Executed plan tasks'],
  'code-review': ['review', 'review', 'Reviewed code'],
  'review-apply': ['review', 'review', 'Applied review findings'],
  'journal-harvest': ['journal', 'journal', 'Harvested learnings'],
  'journal-record': ['journal', 'journal', 'Recorded learnings to journal'],
};
const PASS_SCOPED = new Set(['spec-audit', 'spec-audit-apply', 'plan-audit', 'plan-audit-apply', 'code-review', 'review-apply']);

const sql = postgres(DB);
try {
  const [proj] = await sql`select details, details_version, completed_at from forge.project where id=${PID}`;
  const batches = await sql`select handler, status, created_at, terminal_at from forge.ops_mma_batch where project_id=${PID} and handler is not null order by created_at asc`;
  const members = await sql`select id, display_name from forge.team_member`;
  const mmap = Object.fromEntries(members.map((m) => [m.id, m.display_name]));
  const nameFor = (id) => (id === FORGE ? 'Forge' : (mmap[id] ?? 'Forge'));
  const d = proj.details;
  const iso = (t) => new Date(t).toISOString();
  const lastDone = (h) => batches.filter((b) => b.handler === h && b.status === 'done').pop();

  const events = [];
  const pass = {};
  for (const b of batches) {
    const map = HANDLER[b.handler];
    if (!map) continue;
    const [stage, phase, base] = map;
    const durationMs = b.terminal_at ? new Date(b.terminal_at).getTime() - new Date(b.created_at).getTime() : undefined;
    let detail = base, kind = 'done';
    if (b.status !== 'done') { kind = 'error'; detail = `${base} — failed`; }
    else if (PASS_SCOPED.has(b.handler)) { pass[b.handler] = (pass[b.handler] || 0) + 1; detail = `${base} (pass ${pass[b.handler]})`; }
    events.push({ stage, phase, detail, kind, durationMs, at: iso(b.created_at) });
  }

  // Component approvals (Craft) — anchored just after the successful draft
  const comps = d.stages?.spec?.phases?.craft?.components ?? [];
  const draft = lastDone('spec-auto-draft');
  let anchor = draft?.terminal_at ? new Date(draft.terminal_at).getTime() : new Date(batches[0]?.created_at ?? Date.now()).getTime();
  const tids = comps.map((c) => c.templateId).filter(Boolean);
  const tpls = tids.length ? await sql`select id, label from forge.team_spec_template where id = any(${tids})` : [];
  const tmap = Object.fromEntries(tpls.map((t) => [t.id, t.label]));
  let n = 0;
  for (const c of comps) {
    if (!c.approvals?.length) continue;
    events.push({ stage: 'spec', phase: 'craft', detail: `${nameFor(c.approvals[0])} approved component: ${tmap[c.templateId] ?? 'component'}`, kind: 'done', at: iso(anchor + (++n) * 1000) });
  }

  // Spec finalize sign-off — after the last apply. If not explicitly recorded but
  // the spec is done (it advanced), infer the approver from the component approvals.
  const fin = d.stages?.spec?.phases?.finalize?.approvals ?? [];
  const specDone = d.stages?.spec?.status === 'done';
  const inferred = comps.find((c) => c.approvals?.length)?.approvals?.[0];
  const approverId = fin[0] ?? (specDone ? inferred : null);
  if (approverId) {
    const a = lastDone('spec-audit-apply') ?? lastDone('spec-audit');
    const t = (a?.terminal_at ? new Date(a.terminal_at).getTime() : anchor) + 3000;
    const nm = nameFor(approverId);
    events.push({ stage: 'spec', phase: 'finalize', detail: nm === 'Forge' ? 'Forge approved the spec' : `${nm} approved the spec`, kind: 'done', at: iso(t) });
  }

  // Plan task approvals — after plan authoring
  const tasks = d.stages?.plan?.phases?.refine?.tasks ?? [];
  const author = lastDone('plan-author');
  let tAnchor = author?.terminal_at ? new Date(author.terminal_at).getTime() : anchor;
  let m = 0;
  for (const t of tasks) {
    if (!t.approvals?.length) continue;
    events.push({ stage: 'plan', phase: 'refine', detail: `${nameFor(t.approvals[0])} approved task: ${t.title}`, kind: 'done', at: iso(tAnchor + (++m) * 1000) });
  }

  // Learnings kept — in journal
  const learnings = d.stages?.journal?.phases?.journal?.learnings ?? [];
  const harvest = lastDone('journal-harvest');
  let lAnchor = harvest?.terminal_at ? new Date(harvest.terminal_at).getTime() : anchor;
  let k = 0;
  for (const l of learnings) {
    if (l.status === 'kept' || l.status === 'recorded') {
      let clean = l.heading.replace(/^\[.*?\]\s*/, '').trim(); // drop the [source:X] tag
      // The stored heading was sliced to 120 chars WITH the tag, so it often ends
      // mid-word — trim to a clean word boundary with an ellipsis for the demo.
      if (clean.length > 88) clean = clean.slice(0, 88).replace(/\s+\S*$/, '') + '…';
      events.push({ stage: 'journal', phase: 'journal', detail: `Forge kept learning: ${clean}`, kind: 'done', at: iso(lAnchor + (++k) * 1000) });
    }
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (proj.completed_at) events.push({ stage: '', phase: '', detail: 'All stages complete — project finished', kind: 'done', at: iso(proj.completed_at) });

  d.events = events;
  const res = await sql`update forge.project set details=${sql.json(d)}, details_version=${proj.details_version + 1} where id=${PID} and details_version=${proj.details_version} returning id`;
  console.log(res.length ? `backfilled ${events.length} events` : 'version race (retry)');
  console.log('--- timeline ---');
  for (const e of events) console.log(` ${e.kind === 'error' ? '⚠' : '✓'} [${e.stage || '—'}] ${e.detail}${e.durationMs ? '  (' + Math.round(e.durationMs / 1000) + 's)' : ''}`);
} finally { await sql.end(); }
