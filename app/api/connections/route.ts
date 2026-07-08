import { NextResponse, type NextRequest } from 'next/server';
import { getConnections, updateConnections } from '@/config/connections-core';
import { requireTeamScope } from '@/auth/team-scope';

/**
 * Team Connections API (Spec 2 §Connections).
 * `GET`  → 200 { mmaBaseUrl, gitTokenSet, openaiTranscriptionKeySet }
 *          (NEVER the token/key values — only "set / not set" booleans)
 * `PUT  { mmaBaseUrl?, gitToken?, openaiTranscriptionKey? }`
 *   → 200 the refreshed view  · 400 invalid
 *   → 401 unauthenticated / no team scope
 *
 * The MMA bearer is owned by the local mma (read-only in the UI), never set
 * here. Each section saves independently; git + speech-to-text tokens are stored
 * via the SecretStore and their values never returned.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const scope = await requireTeamScope();
    return NextResponse.json(await getConnections({ teamId: scope.currentTeam.id }));
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const scope = await requireTeamScope();

    const json = await req.json().catch(() => null);
    const result = await updateConnections(json, { actorId: scope.actor.id, teamId: scope.currentTeam.id });

    switch (result.kind) {
      case 'invalid':
        return NextResponse.json({ error: 'Invalid connections fields.' }, { status: 400 });
      case 'saved':
        return NextResponse.json(result.connections);
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
