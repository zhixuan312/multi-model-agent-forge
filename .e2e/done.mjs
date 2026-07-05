import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
const [p] = await sql`select current_stage, completed_at, auto_mode, auto_note,
  details->'stages'->'journal'->>'status' as jstatus from forge.project where id=${PID}`;
console.log('completed_at:', p.completed_at, '| current_stage:', p.current_stage, '| journal:', p.jstatus, '| auto_mode:', p.auto_mode, '| note:', p.auto_note);
await sql.end();
