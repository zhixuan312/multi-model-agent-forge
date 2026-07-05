import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
const [b] = await sql`select id, batch_id, status, created_at from forge.ops_mma_batch where project_id=${PID} and handler='plan-author' and status='running' order by created_at desc limit 1`;
console.log('forge batch:', b?.id, 'mmaTaskId:', b?.batch_id, 'age(s):', b ? Math.round((Date.now()-b.created_at.getTime())/1000) : 'n/a');
if (b?.batch_id) {
  const token = process.env.MMA_TOKEN || 'vzygIAJqic9avYF8DjkG0re-riYFbxoW1FBPhwtA4AI';
  const r = await fetch(`http://localhost:7337/task/${b.batch_id}`, { headers: { Authorization: `Bearer ${token}` }});
  console.log('MMA HTTP', r.status);
  const body = await r.text();
  try { const j = JSON.parse(body); console.log('MMA status/phase:', j.status, j.phase, '| task.status:', j.task?.status, '| err:', j.error?.code); }
  catch { console.log('body:', body.slice(0,200)); }
}
await sql.end();
