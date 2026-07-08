import { describe, expect, it } from 'vitest';
import { buildMultiTenancyStatements, mapLegacyMembersToRoles } from '@/db/migrations/0005_multi_tenancy';

describe('0005 multi-tenancy migration helper', () => {
  it('maps the earliest legacy admin to org_admin and the rest deterministically', () => {
    const mapped = mapLegacyMembersToRoles([
      { id: 'm-1', isAdmin: true, createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'm-2', isAdmin: true, createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: 'm-3', isAdmin: false, createdAt: new Date('2026-01-03T00:00:00Z') },
    ]);
    expect(mapped).toEqual([
      { memberId: 'm-1', role: 'org_admin', teamId: null },
      { memberId: 'm-2', role: 'team_admin', teamId: 'default-team-id' },
      { memberId: 'm-3', role: 'member', teamId: 'default-team-id' },
    ]);
  });

  it('throws when no legacy admin exists', () => {
    expect(() => mapLegacyMembersToRoles([{ id: 'm-1', isAdmin: false, createdAt: new Date() }])).toThrow(
      '0005_multi_tenancy requires at least one legacy is_admin member',
    );
  });

  it('emits add-nullable, backfill, then set-not-null statements', () => {
    const sql = buildMultiTenancyStatements();
    expect(sql.some((line) => line.includes('alter table forge.project add column team_id uuid'))).toBe(true);
    expect(sql.some((line) => line.includes('update forge.project set team_id = $1 where team_id is null'))).toBe(true);
    expect(sql.some((line) => line.includes('alter table forge.project alter column team_id set not null'))).toBe(true);
  });
});
