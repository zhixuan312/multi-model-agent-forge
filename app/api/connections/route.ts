import { NextResponse, type NextRequest } from 'next/server';
import { getConnections, updateConnections } from '@/config/connections-core';
import { currentMember } from '@/auth/current-member';

/**
 * Connections API (Spec 2 §Connections).
 * `GET`  → 200 { mmaBaseUrl, gitTokenSet, openaiTranscriptionKeySet } (booleans, never values)
 * `PUT  { mmaBaseUrl?, gitToken?, openaiTranscriptionKey? }` → 200 refreshed view · 400 invalid
 *
 * Scope split: the ORG-owned singleton fields (mmaBaseUrl, openaiTranscriptionKey) are org_admin
 * only — the singleton is app-wide, so a team admin must never rotate the speech-to-text key for
 * everyone. The TEAM git token needs a team (team admin). Each is authorised independently.
 */
export async function GET(): Promise<NextResponse> {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getConnections({ teamId: me.teamId ?? null }));
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const json = (await req.json().catch(() => null)) as
    | { mmaBaseUrl?: string; gitToken?: string; openaiTranscriptionKey?: string }
    | null;

  const wantsOrgFields = !!json && (json.mmaBaseUrl !== undefined || json.openaiTranscriptionKey !== undefined);
  const wantsGitToken = !!json && json.gitToken !== undefined;
  if (wantsOrgFields && me.role !== 'org_admin') {
    return NextResponse.json({ error: 'Only an org admin can change the MMA connection or speech-to-text key.' }, { status: 403 });
  }
  // The git token is a team-owned secret; setting it is a team-admin action (the
  // git-token UI lives on the team-admin-only settings/team page). Checking only
  // `!me.teamId` let any plain member rotate their team's git credential.
  if (wantsGitToken && !(me.role === 'team_admin' && me.teamId)) {
    return NextResponse.json({ error: 'A team admin is required to set the git token.' }, { status: 403 });
  }

  const result = await updateConnections(json, {
    actorId: me.id,
    teamId: me.teamId ?? null,
    isOrgAdmin: me.role === 'org_admin',
  });

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: 'Invalid connections fields.' }, { status: 400 });
    case 'saved':
      return NextResponse.json(result.connections);
  }
}
