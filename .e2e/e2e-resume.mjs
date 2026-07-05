// Resume monitor: start auto (NO reset — preserve in-flight progress) + monitor
// every layer until terminal. Use after a dev-server restart mid-run. Emits the
// same compact timeline as e2e-run and prints a VERDICT on completion/error/stall.
import { mintSession, startAuto, snapshot } from './e2e-lib.mjs';

const POLL_MS = 8000;
const STALL_MS = 15 * 60 * 1000;
const MAX_MS = 6 * 60 * 60 * 1000;

function ts() { return new Date().toISOString().slice(11, 19); }
function sig(s) { return `${s.currentStage}/${s.phase}|events=${s.events.length}|last=${s.events.at(-1)?.detail ?? ''}|b=${s.batches.length}|inf=${s.inflightCount}`; }

const token = await mintSession();
const start = await startAuto(token);
console.log(`${ts()} RESUME  http=${start.status} ${start.body.slice(0, 120)}`);

let lastSig = '';
let lastChangeAt = Date.now();
const t0 = Date.now();
let prevEventCount = 0;

while (true) {
  await new Promise(res => setTimeout(res, POLL_MS));
  let s;
  try { s = await snapshot(); } catch (e) { console.log(`${ts()} poll-error ${String(e).slice(0, 100)}`); continue; }

  for (let i = prevEventCount; i < s.events.length; i++) {
    const st = s.events[i];
    console.log(`${ts()} EVENT[${i}] ${st.kind === 'error' ? '⚠' : st.kind === 'done' ? '✓' : '•'} [${st.stage}] ${st.detail}`);
  }
  prevEventCount = s.events.length;

  const cur = sig(s);
  if (cur !== lastSig) {
    lastSig = cur; lastChangeAt = Date.now();
    const inflightBatch = s.batches.find(b => b.s === 'dispatched' || b.s === 'running');
    console.log(`${ts()} STATE  ${s.currentStage}/${s.phase} auto=${s.autoMode} inflight=${s.inflightCount}${inflightBatch ? ` (${inflightBatch.h})` : ''} | stages=${JSON.stringify(s.stageStatus)}`);
  }

  const allDone = Object.values(s.stageStatus).every(v => v === 'done');
  if (s.completedAt || allDone) {
    console.log(`${ts()} VERDICT COMPLETE  completedAt=${s.completedAt} stages=${JSON.stringify(s.stageStatus)}`);
    console.log(`${ts()} BATCHES ${JSON.stringify(s.batches)}`);
    break;
  }
  if (!s.autoMode && s.autoNote && /^Failed/.test(s.autoNote)) {
    console.log(`${ts()} VERDICT ERROR  note="${s.autoNote}"`);
    console.log(`${ts()} BATCHES ${JSON.stringify(s.batches)}`);
    break;
  }
  if (!s.autoMode && !s.completedAt) {
    console.log(`${ts()} VERDICT STOPPED  autoMode=false note="${s.autoNote}" (not complete)`);
    break;
  }
  if (s.inflightCount === 0 && Date.now() - lastChangeAt > STALL_MS) {
    console.log(`${ts()} VERDICT STALL  no progress + nothing in-flight for ${Math.round((Date.now() - lastChangeAt) / 60000)}m at ${cur}`);
    console.log(`${ts()} BATCHES ${JSON.stringify(s.batches)}`);
    break;
  }
  if (Date.now() - t0 > MAX_MS) {
    console.log(`${ts()} VERDICT TIMEOUT  ${Math.round((Date.now() - t0) / 60000)}m at ${cur}`);
    break;
  }
}
process.exit(0);
