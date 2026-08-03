// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
const currentMember = vi.fn();

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/auth/current-member', () => ({ currentMember }));

const { requireOrgAdminPage, requireTeamAdminPage, requireTeamPage, requireAdminPage } =
  await import('@/auth/require-admin');

const who = (role: string, teamId: string | null) => ({
  id: 'm1', username: 'u', displayName: 'U', avatarTint: '#111', role, teamId,
});

beforeEach(() => vi.clearAllMocks());

/**
 * Eleven pages open-coded these gates. Four of the org ones sent an UNAUTHENTICATED
 * visitor to `/` rather than `/login`, while two did it correctly — the kind of drift a
 * shared gate removes. Each gate's redirect target is a security decision, so each is
 * pinned here.
 */
describe('page role gates', () => {
  describe('requireOrgAdminPage', () => {
    it('lets the org admin through', async () => {
      currentMember.mockResolvedValue(who('org_admin', null));
      await expect(requireOrgAdminPage()).resolves.toMatchObject({ role: 'org_admin' });
    });

    it('sends an unauthenticated visitor to /login, not /', async () => {
      currentMember.mockResolvedValue(null);
      await expect(requireOrgAdminPage()).rejects.toThrow('REDIRECT:/login');
    });

    it('turns a team admin away', async () => {
      currentMember.mockResolvedValue(who('team_admin', 't1'));
      await expect(requireOrgAdminPage()).rejects.toThrow('REDIRECT:/');
    });
  });

  describe('requireTeamAdminPage', () => {
    it('lets a team admin with a team through', async () => {
      currentMember.mockResolvedValue(who('team_admin', 't1'));
      await expect(requireTeamAdminPage()).resolves.toMatchObject({ teamId: 't1' });
    });

    it('turns away a team admin with no team — a corrupt session, not a state to render', async () => {
      currentMember.mockResolvedValue(who('team_admin', null));
      await expect(requireTeamAdminPage()).rejects.toThrow('REDIRECT:/');
    });

    it('turns away the org admin and a plain member', async () => {
      for (const role of ['org_admin', 'member']) {
        currentMember.mockResolvedValue(who(role, 't1'));
        await expect(requireTeamAdminPage()).rejects.toThrow('REDIRECT:/');
      }
    });
  });

  describe('requireTeamPage', () => {
    /** A plain member may read their own team's pages — this is not an admin gate. */
    it('lets a plain member through', async () => {
      currentMember.mockResolvedValue(who('member', 't1'));
      await expect(requireTeamPage()).resolves.toMatchObject({ teamId: 't1' });
    });

    it('sends the org admin to /usage, which is the view for their role', async () => {
      currentMember.mockResolvedValue(who('org_admin', null));
      await expect(requireTeamPage()).rejects.toThrow('REDIRECT:/usage');
    });
  });

  describe('requireAdminPage', () => {
    it('accepts EITHER admin role — which is why the two specific gates exist', async () => {
      for (const role of ['org_admin', 'team_admin']) {
        currentMember.mockResolvedValue(who(role, 't1'));
        await expect(requireAdminPage()).resolves.toMatchObject({ role });
      }
      currentMember.mockResolvedValue(who('member', 't1'));
      await expect(requireAdminPage()).rejects.toThrow('REDIRECT:/');
    });
  });
});
