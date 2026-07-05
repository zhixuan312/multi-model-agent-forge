import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
await sql`update forge.project set auto_mode=false where id=${PID}`;
await sql`update forge.ops_mma_batch set status='failed', terminal_at=now() where project_id=${PID} and status in ('dispatched','running')`;
console.log('driver stopped (auto_mode=false, inflight failed)');
await sql.end();
