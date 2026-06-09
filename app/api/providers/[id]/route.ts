import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { updateProvider, deleteProvider } from '@/config/providers-core';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin Providers API — update / delete one provider (Spec 2 §Providers).
 * `PATCH { name?, type?, baseUrl?, apiKey? }`
 *   → 200 the updated view  · 404 unknown  · 409 duplicate name  · 400 invalid
 * `DELETE` → 204  · 404 unknown
 * Gate: 403 non-admin / 401 unauthenticated. The api key is never echoed.
 */
export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const json = await req.json().catch(() => null);
  const result = await updateProvider(id, json);

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: 'Invalid provider fields.' }, { status: 400 });
    case 'not_found':
      return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
    case 'duplicate_name':
      return NextResponse.json(
        { error: 'A provider with that name already exists.', field: 'name' },
        { status: 409 },
      );
    case 'updated':
      return NextResponse.json(result.provider);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const result = await deleteProvider(id);
  switch (result.kind) {
    case 'not_found':
      return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
    case 'deleted':
      return new NextResponse(null, { status: 204 });
  }
}
