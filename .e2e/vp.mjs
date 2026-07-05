import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
const [p] = await sql`select details, current_stage from forge.project where id=${PID}`;
const t = p.details.stages.plan.phases.refine.tasks;
console.log('current_stage:', p.current_stage, '| tasks:', t.length, '| approved:', t.filter(x=>x.approvals?.length>0).length, '| validated:', t.filter(x=>x.validated || x.validation).length);
await sql.end();
