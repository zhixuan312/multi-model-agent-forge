import postgres from 'postgres';
import { DB, PID } from './e2e-lib.mjs';
const sql = postgres(DB);
const [p] = await sql`select details, current_stage from forge.project where id=${PID}`;
const repos = p.details.stages.review.phases.review.repos;
console.log('current_stage:', p.current_stage);
console.log('review repos:', JSON.stringify(repos.map(r=>({repo:r.repoId?.slice(0,8), passes:r.reviewPasses?.length, statuses:r.reviewPasses?.map(x=>x.status)}))));
// any review-apply/code-review batch failed AFTER 18:56 (this run)?
const bad = await sql`select handler, status, created_at from forge.ops_mma_batch where project_id=${PID} and handler in ('code-review','review-apply') and status='failed' and created_at > '2026-07-05 18:56:00+00' order by created_at desc`;
console.log('NEW failed review batches this run:', bad.length, JSON.stringify(bad.map(b=>({h:b.handler,t:b.created_at.toISOString().slice(11,19)}))));
await sql.end();
