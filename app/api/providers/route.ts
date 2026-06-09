import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { listProviders, createProvider } from '@/config/providers-core';

/**
 * Admin Providers API (Spec 2 §Providers).
 * `GET`  → 200 [{ id, name, type, baseUrl, apiKeySet, createdAt }]   (NEVER the key)
 * `POST { name, type, baseUrl?, apiKey? }`
 *   → 201 the created provider view (apiKeySet boolean, never the key)
 *   → 409 duplicate name
 *   → 400 invalid (missing name / bad type)
 *   → 403 non-admin / 401 unauthenticated
 *
 * Admin-gated server-side (the authoritative gate). The api key, if provided, is
 * stored via the SecretStore and never echoed back.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  return NextResponse.json(await listProviders());
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const json = await req.json().catch(() => null);
  const result = await createProvider(json);

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json(
        { error: 'A name and a valid type (claude | codex) are required.' },
        { status: 400 },
      );
    case 'duplicate_name':
      return NextResponse.json(
        { error: 'A provider with that name already exists.', field: 'name' },
        { status: 409 },
      );
    case 'created':
      return NextResponse.json(result.provider, { status: 201 });
  }
}
