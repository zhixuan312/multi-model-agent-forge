import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { listRepos, cloneAndRegister } from '@/git/repos-core';
import { rejectCrossOrigin } from '@/auth/same-origin';

/**
 * Workspace repos API (Spec 2 §Workspace).
 * `GET`  → 200 [{ id, name, kind, tags, defaultBranch, status, headSha, … }]
 *          (admin-gated read; the list feeds the client filter island).
 * `POST { name, url, kind?, tags? }` → admin add+clone (Flow B):
 *          → 201 the cloned repo  · 409 duplicate name  · 400 invalid
 *          · 502 clone error (row left at status='error')
 *
 * Mutations are same-origin enforced (CSRF, F12) in addition to the admin gate.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  return NextResponse.json(await listRepos());
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const json = await req.json().catch(() => null);
  const result = await cloneAndRegister(json);

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: result.message ?? 'Invalid repo fields.' }, { status: 400 });
    case 'duplicate_name':
      return NextResponse.json(
        { error: 'A repo with that name is already registered.', field: 'name' },
        { status: 409 },
      );
    case 'error':
      return NextResponse.json({ error: result.message, repo: result.repo }, { status: 502 });
    case 'cloned':
      return NextResponse.json(result.repo, { status: 201 });
  }
}
