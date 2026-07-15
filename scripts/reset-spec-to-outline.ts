/**
 * Reset a project's Spec stage back to its Outline start (Spec active · Outline active ·
 * Craft/Finalize cleared), preserving everything upstream/downstream — exploration,
 * captured intent, Plan, and the skip states. Used to re-test the Outline→Craft flow on a
 * project that already confirmed its outline. Only touches the spec stage.
 *
 *   npx tsx --env-file=.env scripts/reset-spec-to-outline.ts <projectId>
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('usage: reset-spec-to-outline <projectId>');

  const db = getDb();
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, id)).limit(1);
  if (!row?.details) throw new Error(`project ${id} not found`);

  const d = validateDetails(row.details);
  const sp = d.stages.spec;
  sp.status = 'active';
  sp.phases.outline.status = 'active';
  sp.phases.outline.selectedTemplateIds = [];
  sp.phases.craft.status = 'pending';
  sp.phases.craft.components = [];
  sp.phases.craft.attempts = [];
  sp.phases.finalize.status = 'pending';
  sp.phases.finalize.auditPasses = [];
  sp.phases.finalize.approvals = [];

  const validated = validateDetails(d);
  await db.update(project).set({ details: validated, currentStage: 'spec' }).where(eq(project.id, id));
  console.log(`reset spec → outline start for ${id}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
