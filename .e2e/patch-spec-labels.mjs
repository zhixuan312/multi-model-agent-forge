// Retroactively fix THIS run's already-logged spec events (labels only):
//  - "Audited spec" -> "Audited spec (pass N)"
//  - "Applied spec audit findings" -> "Applied spec audit findings (pass N)"
//  - "Spec audit done — approving spec" -> "Forge approved the spec"
// Optimistic-lock safe (retries on version bump) so it never clobbers the live
// driver's concurrent appends.
import postgres from 'postgres';
const DB = process.env.DATABASE_URL; // set DATABASE_URL before running — never hardcode credentials
const PID = '97801cb6-8d2c-4745-b3bb-b7166053a758';
const sql = postgres(DB);
try {
  let done = false;
  for (let attempt = 0; attempt < 6 && !done; attempt++) {
    const [row] = await sql`select details, details_version from forge.project where id=${PID}`;
    const d = row.details;
    let auditN = 0, applyN = 0, changed = 0;
    for (const e of d.events) {
      if (e.stage !== 'spec') continue;
      if (e.detail === 'Audited spec') { auditN++; e.detail = `Audited spec (pass ${auditN})`; changed++; }
      else if (e.detail === 'Applied spec audit findings') { applyN++; e.detail = `Applied spec audit findings (pass ${applyN})`; changed++; }
      else if (/^Spec audit done/.test(e.detail) || e.detail === 'approving spec') { e.detail = 'Forge approved the spec'; changed++; }
    }
    if (changed === 0) { console.log('nothing to patch'); done = true; break; }
    const res = await sql`update forge.project set details=${sql.json(d)}, details_version=${row.details_version + 1}
      where id=${PID} and details_version=${row.details_version} returning id`;
    if (res.length > 0) { console.log(`patched ${changed} spec labels (attempt ${attempt + 1})`); done = true; }
    else { console.log(`version race, retrying (attempt ${attempt + 1})`); }
  }
  if (!done) console.log('FAILED after retries');
  const [after] = await sql`select details->'events' ev from forge.project where id=${PID}`;
  console.log('--- spec events now ---');
  for (const e of after.ev) if (e.stage === 'spec' && (e.detail.includes('pass') || e.detail.includes('Forge') || e.detail.includes('audit'))) console.log(` ${e.kind === 'error' ? '⚠' : '✓'} ${e.detail}${e.durationMs ? ' ('+Math.round(e.durationMs/1000)+'s)' : ''}`);
} finally { await sql.end(); }
