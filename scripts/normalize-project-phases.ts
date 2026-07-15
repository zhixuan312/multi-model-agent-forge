/**
 * One-off: normalize a subset project's phase statuses to the truthful skipped/done model.
 * Projects created before the fix marked the intermediate phases of an uploaded/skipped
 * stage as `done`; the real model is `skipped` (never ran) with only the artifact-bearing
 * phase `done`. This flips only those phases in place — everything else (repos, progress,
 * files, approvals) is preserved. Idempotent and safe to re-run.
 *
 *   npx tsx --env-file=.env scripts/normalize-project-phases.ts <projectId>
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';

type Phase = { status?: string; file?: string };
type Stage = { status?: string; phases?: Record<string, Phase> };
type DetailsShape = { stages?: Record<string, Stage> };

function normalize(details: DetailsShape): DetailsShape {
  const s = details.stages;
  if (!s) return details;
  const set = (stage: string, phase: string, status: string) => {
    const p = s[stage]?.phases?.[phase];
    if (p) p.status = status;
  };

  const ex = s.exploration;
  if (ex?.status === 'skipped') {
    set('exploration', 'brief', 'skipped');
    set('exploration', 'discover', 'skipped');
    set('exploration', 'synthesize', 'skipped');
  } else if (ex?.status === 'done' && ex.phases?.synthesize?.file) {
    // satisfied by an uploaded exploration: only synthesize (the artifact) is real
    set('exploration', 'brief', 'skipped');
    set('exploration', 'discover', 'skipped');
    set('exploration', 'synthesize', 'done');
  }

  const sp = s.spec;
  if (sp?.status === 'skipped') {
    set('spec', 'outline', 'skipped');
    set('spec', 'craft', 'skipped');
    set('spec', 'finalize', 'skipped');
  } else if (sp?.status === 'done' && sp.phases?.craft?.file) {
    // satisfied by an uploaded spec: only craft (the artifact) is real
    set('spec', 'outline', 'skipped');
    set('spec', 'craft', 'done');
    set('spec', 'finalize', 'skipped');
  }

  if (s.plan?.status === 'skipped') {
    set('plan', 'refine', 'skipped');
    set('plan', 'validate', 'skipped');
  }
  if (s.execute?.status === 'skipped') {
    set('execute', 'configure', 'skipped');
    set('execute', 'implement', 'skipped');
  }
  if (s.review?.status === 'skipped') set('review', 'review', 'skipped');

  return details;
}

const phaseSnapshot = (d: DetailsShape) =>
  Object.fromEntries(
    Object.entries(d.stages ?? {}).map(([k, v]) => [
      `${k}(${v.status})`,
      Object.fromEntries(Object.entries(v.phases ?? {}).map(([pk, pv]) => [pk, pv.status])),
    ]),
  );

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('usage: normalize-project-phases <projectId>');

  const db = getDb();
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!row) throw new Error(`project ${id} not found`);

  const before = JSON.parse(JSON.stringify(row.details)) as DetailsShape;
  const normalized = normalize(row.details as DetailsShape);
  const validated = validateDetails(normalized);

  await db.update(project).set({ details: validated }).where(eq(project.id, id));

  console.log(`Updated project ${id}\n`);
  console.log('BEFORE:', JSON.stringify(phaseSnapshot(before), null, 2));
  console.log('\nAFTER :', JSON.stringify(phaseSnapshot(validated as DetailsShape), null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
