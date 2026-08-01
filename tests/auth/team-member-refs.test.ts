// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { listTeamMemberRefs } from '@/auth/members-core';
import { createMockDb } from '../test-utils/mock-db';

/** Bound literal values inside a drizzle SQL node, found without walking into cycles. */
function collectParams(node: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth = 0): void => {
    if (v === null || v === undefined || depth > 8) return;
    if (typeof v !== 'object') { out.push(v); return; }
    if (seen.has(v)) return;
    seen.add(v);
    for (const child of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
      visit(child, depth + 1);
    }
  };
  visit(node);
  return out;
}

/**
 * FR-9 team isolation for the collaborator pool.
 *
 * The spec and plan pages each inlined `select(...).from(member)` with NO where clause, so
 * their invite / @-mention pickers listed every member of every team — one organisation's
 * display names and avatar tints rendered to another — and re-read the whole member table
 * on every page render. (The invite WRITE routes were always scoped, so this was disclosure
 * in the picker, not an escalation path.) `listTeamMemberRefs` is now the one implementation
 * of that scope; these lock it so a call site cannot reintroduce the unscoped read.
 */
describe('listTeamMemberRefs — the collaborator pool is team-scoped', () => {
  it('filters on the caller team id', async () => {
    const db = createMockDb({
      'select:team_member': [{ id: 'm1', displayName: 'Ada', avatarTint: '#111' }],
    });
    const rows = await listTeamMemberRefs('team-1', { db });
    expect(rows).toEqual([{ id: 'm1', displayName: 'Ada', avatarTint: '#111' }]);

    // White-box: assert a WHERE was actually issued and that it binds the team id. The
    // mock cannot evaluate SQL, so without this a missing predicate would still "pass".
    // Drizzle expressions are circular (column -> table -> column), so compare the bound
    // parameters rather than serialising the whole node.
    const where = db._callsFor('team_member').find((c) => c.method === 'where');
    expect(where).toBeDefined();
    const params = collectParams(where!.args[0]);
    expect(params).toContain('team-1');
  });

  it('returns [] for a member with no team instead of falling back to everyone', async () => {
    // An org admin has no team context. Returning every member here is precisely the bug
    // being fixed, so the empty result is deliberate, not an oversight.
    const db = createMockDb({ 'select:team_member': [{ id: 'x', displayName: 'X', avatarTint: '#000' }] });
    expect(await listTeamMemberRefs(null, { db })).toEqual([]);
    expect(await listTeamMemberRefs(undefined, { db })).toEqual([]);
    // Nothing was queried at all — no table read to leak from.
    expect(db._callsFor('team_member')).toEqual([]);
  });

  it('selects only the three fields the picker renders', async () => {
    const db = createMockDb({
      'select:team_member': [{ id: 'm1', displayName: 'Ada', avatarTint: '#111' }],
    });
    const [row] = await listTeamMemberRefs('team-1', { db });
    expect(Object.keys(row).sort()).toEqual(['avatarTint', 'displayName', 'id']);
  });
});
