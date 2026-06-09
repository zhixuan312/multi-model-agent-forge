import { getTableColumns, getTableName } from 'drizzle-orm';
import { member, memberIdentity, session } from '@/db/schema/identity';
import { appSecrets } from '@/db/schema/secrets';
import * as schema from '@/db/schema';

/** Map a Drizzle table's columns → { jsColName: db_col_name }. */
function columnNames(table: Parameters<typeof getTableColumns>[0]) {
  const cols = getTableColumns(table);
  return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.name]));
}

describe('db/schema — table objects expose the expected columns (no live DB)', () => {
  it('member has the canonical columns + db names', () => {
    expect(getTableName(member)).toBe('member');
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

  it('member_identity has the canonical columns; provider NOT NULL, credential cols nullable', () => {
    expect(getTableName(memberIdentity)).toBe('member_identity');
    expect(columnNames(memberIdentity)).toEqual({
      id: 'id',
      memberId: 'member_id',
      provider: 'provider',
      providerAccountId: 'provider_account_id',
      passwordHash: 'password_hash',
      passwordChangedAt: 'password_changed_at',
      metadata: 'metadata',
      createdAt: 'created_at',
    });
    const cols = getTableColumns(memberIdentity);
    expect(cols.memberId.notNull).toBe(true);
    expect(cols.provider.notNull).toBe(true);
    // local rows carry NULLs here — must be nullable
    expect(cols.providerAccountId.notNull).toBe(false);
    expect(cols.passwordHash.notNull).toBe(false);
    expect(cols.passwordChangedAt.notNull).toBe(false);
  });

  it('session has the canonical columns; token_hash + expires_at NOT NULL', () => {
    expect(getTableName(session)).toBe('session');
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
    expect(getTableName(appSecrets)).toBe('app_secrets');
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

  it('the schema barrel re-exports all four tables', () => {
    expect(schema.member).toBe(member);
    expect(schema.memberIdentity).toBe(memberIdentity);
    expect(schema.session).toBe(session);
    expect(schema.appSecrets).toBe(appSecrets);
  });
});
