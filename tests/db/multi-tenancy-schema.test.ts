import { describe, expect, it } from 'vitest';
import { TEAM_ROLE } from '@/db/enums';
import { team, teamSpecTemplate } from '@/db/schema/team';
import { member, connectionSettings } from '@/db/schema/identity';

describe('multi-tenancy schema primitives', () => {
  it('exports the exact role tuple', () => {
    expect(TEAM_ROLE).toEqual(['org_admin', 'team_admin', 'member']);
  });

  it('adds the tenant team table without removing teamSpecTemplate', () => {
    expect(team.id.name).toBe('id');
    expect(team.slug.name).toBe('slug');
    expect(team.workspaceRootPath.name).toBe('workspace_root_path');
    expect(team.gitTokenRef.name).toBe('git_token_ref');
    expect(teamSpecTemplate.kind.name).toBe('kind');
  });

  it('replaces bare admin storage with role + team membership', () => {
    expect(member.role.name).toBe('role');
    expect(member.teamId.name).toBe('team_id');
    expect('isAdmin' in member).toBe(false);
  });

  it('keeps org-owned connection settings and drops team-owned git token storage', () => {
    expect(connectionSettings.mmaBaseUrl.name).toBe('mma_base_url');
    expect(connectionSettings.openaiTranscriptionKeyRef.name).toBe('openai_transcription_key_ref');
    expect('gitTokenRef' in connectionSettings).toBe(false);
  });
});
