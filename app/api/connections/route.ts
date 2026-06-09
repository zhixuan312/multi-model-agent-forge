import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { getConnections, updateConnections } from '@/config/connections-core';

/**
 * Admin Connections API (Spec 2 §Connections).
 * `GET`  → 200 { mmaBaseUrl, mmaTokenSet, gitTokenSet, openaiTranscriptionKeySet }
 *          (NEVER the token/key values — only "set / not set" booleans)
 * `PUT  { mmaBaseUrl?, mmaToken?, gitToken?, openaiTranscriptionKey? }`
 *   → 200 the refreshed view  · 400 invalid
 *   → 403 non-admin / 401 unauthenticated
 *
 * Each section saves independently; tokens are stored via the SecretStore and
 * their values never returned. Part-A: no config write / MMA restart.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  return NextResponse.json(await getConnections());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const json = await req.json().catch(() => null);
  const result = await updateConnections(json);

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: 'Invalid connections fields.' }, { status: 400 });
    case 'saved':
      return NextResponse.json(result.connections);
  }
}
