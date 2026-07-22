// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

const usageByProject = vi.fn(async () => []);
const routeAggForProject = vi.fn(async () => []);
const usageByLoop = vi.fn(async () => []);
const routeAggForLoop = vi.fn(async () => []);
const usageStandalone = vi.fn(async () => []);
let member: { role: string; teamId: string | null };
const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });

vi.mock('@/auth/require-admin', () => ({ requireAdminPage: async () => member }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/usage/usage-core', () => ({
  usageByProject, routeAggForProject, usageByLoop, routeAggForLoop, usageStandalone,
}));

const Projects = (await import('../../app/(app)/usage/projects/page')).default;
const Loops = (await import('../../app/(app)/usage/loops/page')).default;
const Standalone = (await import('../../app/(app)/usage/standalone/page')).default;

const sp = { searchParams: Promise.resolve({}) };

describe('usage sub-pages are team-scoped (no cross-team leak) [QA HIGH]', () => {
  beforeEach(() => {
    [usageByProject, routeAggForProject, usageByLoop, routeAggForLoop, usageStandalone, redirect].forEach((f) => f.mockClear());
  });

  it('team admin: every list query carries the caller teamId', async () => {
    member = { role: 'team_admin', teamId: 'team-1' };
    await Projects(sp);
    expect(usageByProject).toHaveBeenCalledWith('month', { teamId: 'team-1' });
    await Loops(sp);
    expect(usageByLoop).toHaveBeenCalledWith('month', { teamId: 'team-1' });
    await Standalone(sp);
    expect(usageStandalone).toHaveBeenCalledWith('month', { teamId: 'team-1' });
  });

  it('org admin (no team) is redirected to /usage instead of seeing every team\'s content', async () => {
    member = { role: 'org_admin', teamId: null };
    await expect(Projects(sp)).rejects.toThrow('REDIRECT:/usage');
    await expect(Loops(sp)).rejects.toThrow('REDIRECT:/usage');
    await expect(Standalone(sp)).rejects.toThrow('REDIRECT:/usage');
    expect(usageByProject).not.toHaveBeenCalled();
    expect(usageByLoop).not.toHaveBeenCalled();
    expect(usageStandalone).not.toHaveBeenCalled();
  });
});
