import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { projectActorFromMember } from '@/auth/team-scope';
import { rejectCrossOrigin } from '@/auth/same-origin';
import { guardProjectRead } from '@/auth/guard-project-write';
import {
  archiveProject,
  changeVisibility,
  changeRepos,
  getProject,
  ProjectAccessError,
  unarchiveProject,
} from '@/projects/projects-core';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    visibility: z.enum(['public', 'private']).optional(),
    repoIds: z.array(z.string().uuid()).min(1).optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (b) => [b.visibility !== undefined, b.repoIds !== undefined, b.archived !== undefined].filter(Boolean).length === 1,
    { message: 'Provide exactly one of `visibility`, `repoIds`, or `archived`.' },
  );

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  // The GATE: auth + membership, 404 for a project this caller cannot see. The second
  // `ProjectAccessError` catch below is a different thing — the mutations enforce their
  // own ownership rules (only the owner may archive) and 403 with the specific reason,
  // which is correct: by then the caller has already proved they can see the project.
  const gate = await guardProjectRead(id);
  if (gate instanceof Response) return gate;
  const actor = projectActorFromMember(gate.member)!;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body.' },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.visibility !== undefined) {
      await changeVisibility(id, parsed.data.visibility, actor);
    } else if (parsed.data.repoIds !== undefined) {
      await changeRepos(id, parsed.data.repoIds, actor);
    } else if (parsed.data.archived) {
      await archiveProject(id, actor);
    } else {
      await unarchiveProject(id, actor);
    }
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }

  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  return NextResponse.json({
    id: project.id,
    archived: project.archived,
    visibility: project.visibility,
    phase: project.phase,
  });
}
