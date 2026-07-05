import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
const [p] = await sql`select details, auto_mode from forge.project where id=${PID}`;
console.log('auto_mode:', p.auto_mode);
console.log('automation:', JSON.stringify(p.details.automation));
// the done spec-audit batch result shape
const [b] = await sql`select id, status, result from forge.ops_mma_batch where project_id=${PID} and handler='spec-audit' and status='done' order by created_at desc limit 1`;
const r = b.result;
console.log('done batch id:', b.id);
console.log('result top keys:', r ? Object.keys(r) : null);
console.log('has output.findings?', r?.output?.findings?.length, 'output.summary?', !!r?.output?.summary);
console.log('error?', r?.error?.message);
await sql.end();
