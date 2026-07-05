import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
const [p] = await sql`select details, current_stage from forge.project where id=${PID}`;
console.log('current_stage:', p.current_stage);
console.log('plan.validate.auditPasses:', p.details.stages.plan.phases.validate.auditPasses.length);
console.log('exec.status:', p.details.stages.execute.status, '| exec phase configure/implement:',
  p.details.stages.execute.phases.configure.status, p.details.stages.execute.phases.implement.status);
await sql.end();
