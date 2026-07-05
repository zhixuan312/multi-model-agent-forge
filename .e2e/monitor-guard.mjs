// Live guard monitor: samples in-flight MMA batches, maps each to its (stage/phase),
// and flags any sample where >=2 DIFFERENT phases are in flight at once — the exact
// cross-phase-overlap invariant (AC4) that G1+G2+G3 must prevent. Also records phase
// transitions + completion. Writes JSONL to .e2e/logs/monitor.jsonl and prints a
// compact live line. Exits when completed_at is set, journal is done, or max window.
import postgres from 'postgres';
import fs from 'node:fs';
import { DB, PID } from './e2e-lib.mjs';

// Handler -> "stage/phase" (mirror of project-event-labels HANDLER_EVENT).
const PHASE = {
  'explore-propose': 'exploration/discover', 'explore-synthesize': 'exploration/synthesize',
  'spec-auto-draft': 'spec/craft', 'spec-refine': 'spec/craft', 'spec-learnings': 'spec/craft',
  'spec-audit': 'spec/finalize', 'spec-audit-apply': 'spec/finalize',
  'plan-author': 'plan/refine', 'plan-refine': 'plan/refine',
  'plan-audit': 'plan/validate', 'plan-audit-apply': 'plan/validate',
  'execute-pipeline': 'execute/implement',
  'code-review': 'review/review', 'review-apply': 'review/review',
  'journal-harvest': 'journal/journal', 'journal-record': 'journal/journal',
};

const LOG = new URL('./logs/monitor.jsonl', import.meta.url).pathname;
fs.writeFileSync(LOG, '');
const stamp = () => new Date().toISOString().slice(11, 19);

const sql = postgres(DB);
const MAX_MS = 60 * 60 * 1000; // 60 min hard cap
const start = Date.now();
let lastStageKey = '';
let lastInflightKey = '';
let violations = 0;
let driverSeen = new Set();
let maxHbAge = 0;      // largest heartbeat age seen (proves the bg-timer fix)
let staleHbSamples = 0; // samples where hb age exceeded the 45s alarm line

try {
  while (Date.now() - start < MAX_MS) {
    const [p] = await sql`select current_stage, phase, auto_mode, auto_note, completed_at,
      details->'automation'->>'status' as astatus,
      details->'automation'->>'driverId' as driver,
      extract(epoch from (now() - (details->'automation'->>'driverHeartbeatAt')::timestamptz)) as hb_age,
      (select json_agg(json_build_object('h',handler,'s',status)) from forge.ops_mma_batch
        where project_id=${PID} and status in ('dispatched','running')) as inflight
      from forge.project where id=${PID}`;
    const hbAge = p.hb_age == null ? null : Math.round(p.hb_age);
    if (hbAge != null) { maxHbAge = Math.max(maxHbAge, hbAge); if (hbAge > 45) staleHbSamples++; }
    const stageStatus = await sql`select details from forge.project where id=${PID}`.then(([r]) =>
      Object.fromEntries(Object.entries(r.details.stages).map(([k, v]) => [k, v.status])));

    const inflight = p.inflight ?? [];
    const phases = [...new Set(inflight.map((b) => PHASE[b.h] ?? `?/${b.h}`))];
    if (p.driver) driverSeen.add(p.driver);

    const crossPhase = phases.length >= 2;
    if (crossPhase) violations++;

    const rec = {
      t: stamp(), stage: p.current_stage, autoNote: p.auto_note, astatus: p.astatus,
      driver: (p.driver ?? '').slice(0, 8), hbAge, maxHbAge, inflight: inflight.map((b) => b.h),
      phasesInFlight: phases, crossPhaseOverlap: crossPhase,
      distinctDrivers: driverSeen.size, completedAt: p.completed_at,
    };
    fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');

    const stageKey = JSON.stringify(stageStatus);
    const inflightKey = JSON.stringify({ ph: phases, n: inflight.length });
    if (stageKey !== lastStageKey || inflightKey !== lastInflightKey) {
      const flag = crossPhase ? '  <<<< CROSS-PHASE OVERLAP!!!' : '';
      console.log(`${rec.t} ${p.current_stage.padEnd(11)} inflight=[${rec.inflight.join(',') || '-'}] phases=${phases.length} drivers=${driverSeen.size} :: ${p.auto_note ?? ''}${flag}`);
      lastStageKey = stageKey; lastInflightKey = inflightKey;
    }

    if (p.completed_at || stageStatus.journal === 'done') {
      console.log(`\n=== TERMINAL === completedAt=${p.completed_at} journal=${stageStatus.journal}`);
      console.log(`crossPhaseViolations=${violations} distinctDrivers=${driverSeen.size} [${[...driverSeen].map(d=>d.slice(0,8)).join(',')}] maxHbAge=${maxHbAge}s staleHbSamples=${staleHbSamples}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  if (Date.now() - start >= MAX_MS) console.log('\n=== MAX WINDOW REACHED (60m) ===');
} finally {
  await sql.end();
  console.log(`\nSUMMARY: crossPhaseViolations=${violations} distinctDrivers=${driverSeen.size} maxHbAge=${maxHbAge}s staleHbSamples=${staleHbSamples}`);
}
