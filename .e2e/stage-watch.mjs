// Quiet stage-level watcher: emits only on stage/phase change, batch errors, and
// terminal (done/failed). Exits on terminal. Run via Monitor.
import { snapshot } from './e2e-lib.mjs';

function ts() { return new Date().toISOString().slice(11, 19); }
const seenErr = new Set();
let prevStage = '';
let prevInflight = '';

while (true) {
  let s;
  try { s = await snapshot(); } catch { await new Promise(r => setTimeout(r, 15000)); continue; }
  const stage = `${s.currentStage}/${s.phase}`;
  const inflight = s.batches.find(b => b.s === 'dispatched' || b.s === 'running')?.h ?? '-';
  if (stage !== prevStage || inflight !== prevInflight) {
    prevStage = stage; prevInflight = inflight;
    console.log(`${ts()} STAGE ${stage} auto=${s.autoMode} inflight=${s.inflightCount}(${inflight}) | ${JSON.stringify(s.stageStatus)}`);
  }
  for (const b of s.batches) {
    if (b.err && !seenErr.has(b.h + b.err)) { seenErr.add(b.h + b.err); console.log(`${ts()} BATCH-ERR ${b.h}: ${b.err}`); }
  }
  const allDone = Object.values(s.stageStatus).every(v => v === 'done');
  if (s.completedAt || allDone) { console.log(`${ts()} TERMINAL COMPLETE completedAt=${s.completedAt} | ${JSON.stringify(s.stageStatus)}`); break; }
  if (!s.autoMode && /^Failed/.test(s.autoNote || '')) { console.log(`${ts()} TERMINAL FAILED note="${s.autoNote}"`); break; }
  await new Promise(r => setTimeout(r, 20000));
}
