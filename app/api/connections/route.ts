import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { getConnections, updateConnections } from '@/config/connections-core';

/**
 * Admin Connections API (Spec 2 §Connections).
 * `GET`  → 200 { mmaBaseUrl, gitTokenSet, openaiTranscriptionKeySet }
 *          (NEVER the token/key values — only "set / not set" booleans)
 * `PUT  { mmaBaseUrl?, gitToken?, openaiTranscriptionKey? }`
 *   → 200 the refreshed view  · 400 invalid
 *   → 403 non-admin / 401 unauthenticated
 *
 * The MMA bearer is owned by the local mma (read-only in the UI), never set
 * here. Each section saves independently; git + speech-to-text tokens are stored
 * via the SecretStore and their values never returned.
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
