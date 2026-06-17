import { getTableColumns, getTableName } from 'drizzle-orm';
import { member, memberIdentity, session } from '@/db/schema/identity';
import { appSecrets } from '@/db/schema/secrets';
import { connectionSettings } from '@/db/schema/config';
import { repo } from '@/db/schema/workspace';
import * as schema from '@/db/schema';

/** Map a Drizzle table's columns → { jsColName: db_col_name }. */
function columnNames(table: Parameters<typeof getTableColumns>[0]) {
  const cols = getTableColumns(table);
  return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.name]));
}

describe('db/schema — table objects expose the expected columns (no live DB)', () => {
  it('member has the canonical columns + db names', () => {
    expect(getTableName(member)).toBe('team_member');
    expect(columnNames(member)).toEqual({
      id: 'id',
      username: 'username',
      displayName: 'display_name',
      avatarTint: 'avatar_tint',
      isAdmin: 'is_admin',
      createdAt: 'created_at',
    });
  });

  it('member.avatar_tint is NOT NULL with the warm-ember default; is_admin defaults false', () => {
    const cols = getTableColumns(member);
    expect(cols.avatarTint.notNull).toBe(true);
    expect(cols.avatarTint.default).toBe('#9a6b4f');
    expect(cols.isAdmin.notNull).toBe(true);
    expect(cols.isAdmin.default).toBe(false);
    expect(cols.username.notNull).toBe(true);
    expect(cols.displayName.notNull).toBe(true);
  });

  it('member_identity has the canonical columns; credential cols nullable', () => {
    expect(getTableName(memberIdentity)).toBe('team_identity');
    expect(columnNames(memberIdentity)).toEqual({
      id: 'id',
      memberId: 'member_id',
      passwordHash: 'password_hash',
      passwordChangedAt: 'password_changed_at',
      createdAt: 'created_at',
    });
    const cols = getTableColumns(memberIdentity);
    expect(cols.memberId.notNull).toBe(true);
    // local rows carry NULLs here — must be nullable
    expect(cols.passwordHash.notNull).toBe(false);
    expect(cols.passwordChangedAt.notNull).toBe(false);
  });

  it('session has the canonical columns; token_hash + expires_at NOT NULL', () => {
    expect(getTableName(session)).toBe('team_session');
    expect(columnNames(session)).toEqual({
      id: 'id',
      memberId: 'member_id',
      tokenHash: 'token_hash',
      lastUsedAt: 'last_used_at',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
    });
    const cols = getTableColumns(session);
    expect(cols.tokenHash.notNull).toBe(true);
    expect(cols.expiresAt.notNull).toBe(true);
    expect(cols.memberId.notNull).toBe(true);
  });

  it('app_secrets has the canonical columns; value_enc NOT NULL, created_by nullable', () => {
    expect(getTableName(appSecrets)).toBe('team_secret');
    expect(columnNames(appSecrets)).toEqual({
      id: 'id',
      label: 'label',
      valueEnc: 'value_enc',
      createdBy: 'created_by',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
    const cols = getTableColumns(appSecrets);
    expect(cols.label.notNull).toBe(true);
    expect(cols.valueEnc.notNull).toBe(true);
    // created_by is a nullable FK (seed/system writes leave it NULL)
    expect(cols.createdBy.notNull).toBe(false);
  });

  it('team_connection: singleton with nullable refs until configured (no bearer column)', () => {
    expect(getTableName(connectionSettings)).toBe('team_connection');
    expect(columnNames(connectionSettings)).toEqual({
      id: 'id',
      mmaBaseUrl: 'mma_base_url',
      gitTokenRef: 'git_token_ref',
      openaiTranscriptionKeyRef: 'openai_transcription_key_ref',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
    const cols = getTableColumns(connectionSettings);
    // All configured columns nullable until configured.
    expect(cols.mmaBaseUrl.notNull).toBe(false);
    expect(cols.gitTokenRef.notNull).toBe(false);
    expect(cols.openaiTranscriptionKeyRef.notNull).toBe(false);
  });

  it('repo has the canonical columns; repos are classified by tags only, status enum default cloned', () => {
    expect(getTableName(repo)).toBe('workspace_repo');
    expect(columnNames(repo)).toEqual({
      id: 'id',
      name: 'name',
      pathOnDisk: 'path_on_disk',
      defaultBranch: 'default_branch',
      tags: 'tags',
      headSha: 'head_sha',
      status: 'status',
      createdAt: 'created_at',
    });
    const cols = getTableColumns(repo);
    expect(cols.name.notNull).toBe(true);
    expect(cols.name.isUnique).toBe(true);
    expect(cols.pathOnDisk.notNull).toBe(true);
    expect(cols.defaultBranch.notNull).toBe(true);
    expect(cols.status.enumValues).toEqual(['cloned', 'pulling', 'error']);
    expect(cols.status.default).toBe('cloned');
    expect(cols.headSha.notNull).toBe(false);
  });

  it('the schema barrel re-exports all tables incl. config + workspace', () => {
    expect(schema.member).toBe(member);
    expect(schema.memberIdentity).toBe(memberIdentity);
    expect(schema.session).toBe(session);
    expect(schema.appSecrets).toBe(appSecrets);
    expect(schema.connectionSettings).toBe(connectionSettings);
    expect(schema.repo).toBe(repo);
  });
});
