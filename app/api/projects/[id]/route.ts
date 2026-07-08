import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { currentMember } from '@/auth/current-member';
import { rejectCrossOrigin } from '@/auth/same-origin';
import {
  changeVisibility,
  changeRepos,
  getProject,
  getProjectRepos,
  assertProjectReadable,
  ProjectAccessError,
} from '@/projects/projects-core';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Project mutations (Spec 3 flow 5). `PATCH /api/projects/[id]` — body branches:
 * exactly ONE of `{ visibility }` (owner-only) or `{ repoIds }` (equal-rights,
 * ≥1). Preconditions in order: auth → read-guard (404, anti-enumeration) → authz
 * (403). The mutation + its `action_log` row are atomic (in `mutate.ts`). On
 * success returns 200 `{ id, visibility, phase, repoCount }`.
 *
 * Create has NO POST route — it is a server action (flow 1).
 */
const patchSchema = z
  .object({
    visibility: z.enum(['public', 'private']).optional(),
    repoIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .refine(
    (b) => (b.visibility !== undefined) !== (b.repoIds !== undefined),
    { message: 'Provide exactly one of `visibility` or `repoIds`.' },
  );

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body.' },
      { status: 400 },
    );
  }

  // Precondition (2): read-guard FIRST — a hidden/unknown project → 404
  // (anti-enumeration), distinct from the write-authz 403 below.
  try {
    await assertProjectReadable(id, { id: me.id, teamId: me.teamId! });
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }
    throw e;
  }

  // Precondition (3): write-authz — on a KNOWN-readable project, a gate failure
  // is 403 (leaks nothing, the actor already knows the project exists).
  try {
    if (parsed.data.visibility !== undefined) {
      await changeVisibility(id, parsed.data.visibility, { id: me.id, teamId: me.teamId! });
    } else {
      await changeRepos(id, parsed.data.repoIds!, { id: me.id, teamId: me.teamId! });
    }
  } catch (e) {
    if (e instanceof ProjectAccessError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }

  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const repos = await getProjectRepos(id);
  const repoCount = repos.filter((r) => r.available).length;

  return NextResponse.json({
    id: project.id,
    visibility: project.visibility,
    phase: project.phase,
    repoCount,
  });
}
