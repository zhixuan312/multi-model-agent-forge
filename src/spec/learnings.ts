import { eq, asc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { qaMessage } from '@/db/schema/spec';
import { readSpecFileAsync } from '@/projects/project-files';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import { validateDetails, type Details } from '@/details/schema';
import { updateDetails } from '@/details/write';

export interface LearningCandidateView {
  index: number;
  heading: string;
  type: string;
  status: string;
}

export async function buildLearningsPrompt(
  db: Db,
  projectId: string,
): Promise<{ system: string; user: string }> {
  const [proj] = await db
    .select({ name: project.name, details: project.details })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  let intentText: string | null = null;
  if (proj?.details) {
    const { getBriefText } = await import('@/details/read');
    intentText = getBriefText(validateDetails(proj.details));
  }

  const specFile = await readSpecFileAsync(projectId);
  const spec = specFile ? { bodyMd: specFile.bodyMd } : null;

  const rawMsgs = await db
    .select({ bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId })
    .from(qaMessage)
    .where(eq(qaMessage.projectId, projectId))
    .orderBy(asc(qaMessage.createdAt));
  const transcript = rawMsgs.map((m) => {
    const sender = m.authorId === FORGE_MEMBER_ID ? 'forge' : 'member';
    return `- ${sender}: ${m.bodyMd}`;
  }).join('\n');

  const system = [
    "You are Forge's learnings curator. From the locking of a spec, propose the durable",
    'learnings worth recording in the team journal: what was figured out (insight), what',
    'was decided (decision), and what was hard about brainstorming it with Forge (challenge).',
    'Each learning is a self-contained markdown statement. Propose only what is durable',
    'and team-relevant — skip the trivial.',
  ].join('\n');

  const user = [
    `# Project: ${proj?.name ?? '(unknown)'}`,
    `\n## Intent\n${intentText ?? '(none)'}`,
    `\n## Locked specification\n${spec?.bodyMd ?? '(none)'}`,
    transcript ? `\n## Q&A session\n${transcript}` : '',
  ].join('\n');

  return { system, user };
}

export async function setLearningStatus(
  projectId: string,
  index: number,
  status: 'kept' | 'removed',
  deps: { db?: Db } = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  await updateDetails(db, projectId, (d) => {
    if (d.stages.journal.phases.journal.learnings[index]) {
      d.stages.journal.phases.journal.learnings[index].status = status;
    }
    return d;
  });
}

export async function addLearning(
  projectId: string,
  input: { heading: string; type: 'decision' | 'insight' },
  deps: { db?: Db } = {},
): Promise<LearningCandidateView> {
  const db = deps.db ?? getDb();
  let idx = 0;
  await updateDetails(db, projectId, (d) => {
    d.stages.journal.phases.journal.learnings.push({
      heading: input.heading,
      type: input.type,
      status: 'kept',
    });
    idx = d.stages.journal.phases.journal.learnings.length - 1;
    return d;
  });
  return { index: idx, heading: input.heading, type: input.type, status: 'kept' };
}

export async function allCandidates(
  projectId: string,
  deps: { db?: Db } = {},
): Promise<LearningCandidateView[]> {
  const db = deps.db ?? getDb();
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return [];
  const d = validateDetails(row.details);
  return d.stages.journal.phases.journal.learnings.map((l, i) => ({
    index: i, heading: l.heading, type: l.type, status: l.status,
  }));
}
