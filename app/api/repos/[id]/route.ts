import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminTeam } from '@/auth/admin-gate-handler';
import { deleteRepo, pullExisting, updateRepo } from '@/git/repos-core';
import { rejectCrossOrigin } from '@/auth/same-origin';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Workspace repo by id (Spec 2 §Workspace).
 * `PUT`    → admin re-pull (Flow B pull variant): 200 the repo · 404 unknown
 *            · 502 pull error (row left at status='error').
 * `DELETE` → admin remove the row: 204 · 404 unknown.
 * Both are admin-gated + same-origin enforced.
 */
export async function PUT(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminTeam();
  if (!gate.ok) return gate.response;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const { id } = await ctx.params;

  const result = await pullExisting(id, { teamId: gate.teamId });
  switch (result.kind) {
    case 'not_found':
      return NextResponse.json({ error: 'Repo not found.' }, { status: 404 });
    case 'error':
      return NextResponse.json({ error: result.message, repo: result.repo }, { status: 502 });
    case 'pulled':
      return NextResponse.json(result.repo);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminTeam();
  if (!gate.ok) return gate.response;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const result = await updateRepo(id, body, { teamId: gate.teamId });
  switch (result.kind) {
    case 'not_found':
      return NextResponse.json({ error: 'Repo not found.' }, { status: 404 });
    case 'invalid':
      return NextResponse.json({ error: result.message }, { status: 400 });
    case 'updated':
      return NextResponse.json(result.repo);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminTeam();
  if (!gate.ok) return gate.response;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const { id } = await ctx.params;

  const result = await deleteRepo(id, { teamId: gate.teamId });
  switch (result.kind) {
    case 'not_found':
      return NextResponse.json({ error: 'Repo not found.' }, { status: 404 });
    case 'deleted':
      return new NextResponse(null, { status: 204 });
  }
}
