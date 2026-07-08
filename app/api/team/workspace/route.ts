import { NextRequest, NextResponse } from 'next/server';
import { currentMember } from '@/auth/current-member';
import { assertTeamAdmin } from '@/auth/team-scope';
import { updateTeamWorkspacePath } from '@/auth/teams-core';
import { getDb } from '@/db/client';

export const runtime = 'nodejs';

/**
 * Team settings → workspace path (Spec FR-8, FR-9). Team-admin self-service for
 * their OWN team: sets `team.workspace_root_path` after validating the candidate
 * is a direct sibling child of the operator workspace base (no symlink escape).
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!member.teamId) {
    return NextResponse.json({ error: 'Team admin privileges required.' }, { status: 403 });
  }
  try {
    assertTeamAdmin(member, member.teamId);
  } catch {
    return NextResponse.json({ error: 'Team admin privileges required.' }, { status: 403 });
  }

  const json = (await req.json().catch(() => null)) as { workspaceRootPath?: unknown } | null;
  const candidate = typeof json?.workspaceRootPath === 'string' ? json.workspaceRootPath : '';
  const result = await updateTeamWorkspacePath(candidate, { teamId: member.teamId, db: getDb() });

  return result.kind === 'invalid'
    ? NextResponse.json({ error: result.reason }, { status: 400 })
    : NextResponse.json({ workspaceRootPath: result.workspaceRootPath }, { status: 200 });
}
