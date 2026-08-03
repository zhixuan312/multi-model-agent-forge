// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTeamWithAdmin } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

/**
 * A bare `catch { return duplicate_username }` reported ANY transaction failure — a dead
 * connection, a constraint elsewhere — to the org admin as "that username is taken",
 * sending them off to change a username that was fine. `isUniqueViolation` exists for
 * exactly this distinction and its own doc says both call sites "must agree about what a
 * duplicate looks like".
 */
const input = {
  slug: 'platform',
  workspaceRootPath: 'platform',
  admin: { displayName: 'A', username: 'alice', password: 'password123' },
};

const failingDb = (err: Error) => {
  const db = createMockDb({ 'select:team_member': [] });
  return Object.assign(db, { transaction: async () => { throw err; } }) as typeof db;
};

describe('createTeamWithAdmin distinguishes a duplicate from a failure', () => {
  it('reports a unique violation as duplicate_username', async () => {
    const pgErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    const result = await createTeamWithAdmin(input, { db: failingDb(pgErr) });
    expect(result.kind).toBe('duplicate_username');
  });

  it('does not call an unrelated failure a duplicate', async () => {
    await expect(
      createTeamWithAdmin(input, { db: failingDb(new Error('connection terminated')) }),
    ).rejects.toThrow(/connection terminated/);
  });
});
