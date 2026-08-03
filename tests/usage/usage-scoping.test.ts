// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MMA_ROUTE } from '@/db/enums';

const usageByProject = vi.fn(async () => []);
const routeAggForProject = vi.fn(async () => []);
const usageByLoop = vi.fn(async () => []);
const routeAggForLoop = vi.fn(async () => []);
const usageStandalone = vi.fn(async () => []);
let member: { role: string; teamId: string | null };
const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });

// The team gate now owns the org-admin redirect these pages used to perform themselves,
// so the mock reproduces it. `requireTeamPage`'s own behaviour is covered in
// tests/auth/page-gates.test.ts; this file is about the PAGES staying team-scoped.
vi.mock('@/auth/require-admin', () => ({
  requireTeamPage: async () => {
    if (member.role === 'org_admin' || !member.teamId) redirect('/usage');
    return member;
  },
}));
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

/**
 * `ROUTE_LABELS` was `Record<string, string>` and covered nine of the eleven routes, so a
 * `spec` or `plan` batch appeared in the usage table as the literal "spec"/"plan" beside
 * "Code investigation" and "Journal recall". Total over `MmaRoute` now — a route added to
 * the enum has to be given a label rather than falling through to its raw id.
 */
describe('every MMA route has a human label', () => {
  it('names all of them', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/usage/usage-core.ts', 'utf8'));
    const block = src.slice(src.indexOf('const ROUTE_LABELS'), src.indexOf('satisfies Record<MmaRoute, string>'));
    // Anchored to the start of a line. `toContain('plan:')` matches inside `execute_plan:`,
    // so the loose version passed with `plan` deleted — it asserted nothing for two of the
    // eleven routes, which is the exact gap this test exists to close.
    for (const route of MMA_ROUTE) {
      expect(block, `${route} has no label`).toMatch(new RegExp(`^\\s*${route}:`, 'm'));
    }
  });

  it('is pinned with `satisfies`, so the compiler enforces it too', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/usage/usage-core.ts', 'utf8'));
    expect(src).toContain('satisfies Record<MmaRoute, string>');
  });
});
