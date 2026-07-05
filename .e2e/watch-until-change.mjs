// Polls until the pipeline leaves a given stage, hits an error, completes, or the
// run process dies. Exits (re-invoking the parent agent) with a one-line reason.
import postgres from 'postgres';
import { execSync } from 'node:child_process';
import { DB, PID } from './e2e-lib.mjs';
const FROM = process.argv[2] || 'plan';
const sql = postgres(DB);
const MAX = 90 * 60 * 1000, t0 = Date.now();
function runAlive() { try { execSync('pgrep -f e2e-run.mjs', {stdio:'ignore'}); return true; } catch { return false; } }
while (Date.now() - t0 < MAX) {
  await new Promise(r => setTimeout(r, 20000));
  const [p] = await sql`select current_stage, auto_mode, auto_note, completed_at,
    details->'automation'->>'status' as astatus from forge.project where id=${PID}`;
  if (p.completed_at) { console.log(`COMPLETE at ${p.current_stage}`); break; }
  if (!p.auto_mode && p.astatus !== 'running') { console.log(`AUTO STOPPED stage=${p.current_stage} note="${p.auto_note}"`); break; }
  if (p.current_stage !== FROM) { console.log(`STAGE CHANGED ${FROM} -> ${p.current_stage}`); break; }
  if (!runAlive()) { console.log(`RUN PROCESS EXITED at stage=${p.current_stage}`); break; }
}
await sql.end();
process.exit(0);
