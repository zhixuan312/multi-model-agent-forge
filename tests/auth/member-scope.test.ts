// @vitest-environment node
import { memberScope } from '@/auth/member-scope';
import type { AuthedMember } from '@/auth/auth-provider';

const actor = (role: string, teamId: string | null) => ({ role, teamId } as unknown as AuthedMember);

/**
 * This decides which members an admin may reach. It was a private copy in each of the two
 * member routes; these cases now pin both at once.
 */
describe('memberScope', () => {
  it('leaves an org_admin unscoped — members are org-owned', () => {
    expect(memberScope(actor('org_admin', null))).toEqual({});
    expect(memberScope(actor('org_admin', 'team-1'))).toEqual({});
  });

  it('confines a team_admin to their own team', () => {
    expect(memberScope(actor('team_admin', 'team-1'))).toEqual({ teamId: 'team-1' });
  });

  it('gives a teamless non-org_admin an unmatchable sentinel, NOT org-wide reach', () => {
    // Returning {} here would silently promote them to every member in the org.
    const scope = memberScope(actor('team_admin', null));
    expect(scope).toEqual({ teamId: '__no_team__' });
    expect(scope.teamId).toBeDefined();
  });

  it('treats a plain member the same as a team_admin — scoping is by role, not privilege', () => {
    expect(memberScope(actor('member', 'team-9'))).toEqual({ teamId: 'team-9' });
    expect(memberScope(actor('member', null))).toEqual({ teamId: '__no_team__' });
  });
});
