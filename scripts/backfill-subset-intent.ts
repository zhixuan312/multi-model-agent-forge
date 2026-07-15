/**
 * Backfill project.intent_md for a subset project created from an uploaded artifact
 * before intent-capture was wired (createProject now sets it at creation). Reads the
 * exploration (or spec) artifact the project already stores and sets it as the intent +
 * summary, so the Spec outline gate + spec drafter have the grounding they require.
 * Idempotent — a no-op if intent is already present.
 *
 *   npx tsx --env-file=.env scripts/backfill-subset-intent.ts <projectId>
 */
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { deriveSummary } from '@/spec/summary';
import { stripFrontmatter } from '@/projects/create-project-subset';

type DetailsShape = {
  stages?: {
    exploration?: { phases?: { synthesize?: { file?: string } } };
    spec?: { phases?: { craft?: { file?: string } } };
  };
};

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('usage: backfill-subset-intent <projectId>');

  const db = getDb();
  const [row] = await db
    .select({ details: project.details, intentMd: project.intentMd })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!row) throw new Error(`project ${id} not found`);
  if (row.intentMd && row.intentMd.trim()) {
    console.log('intent already set — no-op');
    return;
  }

  const d = row.details as DetailsShape;
  const file = d.stages?.exploration?.phases?.synthesize?.file ?? d.stages?.spec?.phases?.craft?.file;
  if (!file) throw new Error('no uploaded artifact file path in details');

  const content = stripFrontmatter(await readFile(file, 'utf8'));
  await db.update(project).set({ intentMd: content, summary: deriveSummary(content) }).where(eq(project.id, id));
  console.log(`Set intent for ${id} from ${file} (${content.length} chars)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
