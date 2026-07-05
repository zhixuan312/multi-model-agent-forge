import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
const batches = await sql`select handler, status, created_at, terminal_at from forge.ops_mma_batch where project_id=${PID} and handler like 'plan-%' order by created_at desc limit 4`;
console.log('plan batches:', JSON.stringify(batches.map(b => ({h:b.handler, s:b.status, created:b.created_at?.toISOString().slice(11,19), term:b.terminal_at?.toISOString().slice(11,19)}))));
const [p] = await sql`select details from forge.project where id=${PID}`;
const rf = p.details.stages.plan.phases.refine;
console.log('plan.refine.tasks:', rf.tasks?.length, '| author dispatched?', JSON.stringify(rf.authorAttempt ?? rf.author ?? 'n/a').slice(0,120));
await sql.end();
