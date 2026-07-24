import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { projectJournal } from '@/db/schema/project-journal';
import { project } from '@/db/schema/projects';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { deriveDefaultProjectJournalTopic } from '@/journal/project-journal-topic';
import { validateDetails } from '@/details/schema';

type ProjectJournalType = 'decision' | 'design' | 'behavior' | 'process' | 'knowledge' | 'style';

async function handleJournalHarvest(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const existing = await db.select({ id: projectJournal.id }).from(projectJournal).where(eq(projectJournal.projectId, ctx.projectId)).orderBy(asc(projectJournal.seq));
  if (existing.length > 0) return;

  // NOTE (contract): the terminal envelope is the 6-field shape; a worker's structured
  // output lands at `envelope.output.summary` (parsed JSON), NOT `envelope.output` or
  // `envelope.output.records`. The harvest orchestrate prompt must instruct the worker to
  // emit `{ "records": [{ heading, body, type }] }` as its final JSON.
  const summary = (envelope as { output?: { summary?: { records?: Array<{ heading: string; body: string; type: ProjectJournalType }> } } })?.output?.summary;
  const records = summary?.records ?? [];
  if (records.length === 0) throw new Error('journal-harvest returned no records.');

  const [proj] = await db.select({ details: project.details }).from(project).where(eq(project.id, ctx.projectId)).limit(1);
  const details = proj?.details ? validateDetails(proj.details) : null;
  const topic = deriveDefaultProjectJournalTopic(details?.repos.map((repo) => ({ slug: repo.name })) ?? []);

  await db.insert(projectJournal).values(
    records.map((record, index) => ({
      projectId: ctx.projectId,
      heading: record.heading,
      body: record.body,
      type: record.type,
      topic,
      status: 'proposed' as const,
      seq: index,
    })),
  );
}

registerHandler('journal-harvest', handleJournalHarvest);
