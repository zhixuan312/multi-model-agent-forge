import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { allCandidates } from '@/spec/learnings';
import { FreezeClient } from '@/components/forge/FreezeClient';

/**
 * Freeze stage (Spec 4 Part B) — the learnings-curation screen reached after the
 * irreversible freeze. The project layout already flips `data-phase` cold from
 * `project.phase`. Membership-gated. Loads the existing `learning_candidate` set
 * (the client proposes on first load if empty — idempotent).
 */
export default async function FreezePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) notFound();
    throw e;
  }

  const db = getDb();
  const [proj] = await db
    .select({ phase: project.phase })
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  if (!proj) notFound();

  const candidates = await allCandidates(id, { db });

  return (
    <FreezeClient
      projectId={id}
      locked={proj.phase !== 'design'}
      initialCandidates={candidates.map((c) => ({
        id: String(c.index),
        bodyMd: c.heading,
        type: c.type,
        status: c.status as 'proposed' | 'kept' | 'removed' | 'recorded',
        recordedNodeId: null,
      }))}
    />
  );
}
