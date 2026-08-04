// @vitest-environment node
/**
 * Every page declares the scope it needs beyond "signed in".
 *
 * `app/(app)/layout.tsx` gates the whole group: no valid session, redirect to `/login`. That
 * is the floor, and it is why a page can legitimately carry no guard of its own — the Guide
 * is readable by any member.
 *
 * It is also why the gap is easy to miss. A new page under `settings/` inherits the session
 * check and looks protected, while the thing that makes it an ADMIN page — `requireOrgAdmin`
 * — is a line somebody has to remember to write. Forget it and every member can read the
 * org's teams, model tiers and connections. Nothing failed, nothing looked wrong.
 *
 * So the scope is declared here, per page, and the test checks the declaration is true.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Route → the guard it must call. `'session'` = the layout's gate is the whole requirement. */
const GUARD: Record<string, string> = {
  '/': 'currentMember',
  '/login': 'session', // pre-auth entry point; redirects when already signed in
  '/setup': 'session', // first-run admin creation; guarded by its own "already set up" check

  // Any signed-in member.
  '/profile': 'currentMember',
  '/projects': 'currentMember',
  '/settings': 'currentMember',
  '/usage': 'currentMember',
  '/settings/guide': 'session', // the in-product manual — readable by everyone
  '/settings/guide/[sectionId]': 'session',

  // Team-scoped.
  '/journal': 'requireTeamPage',
  '/projects/new': 'requireTeamPage',
  '/workspace': 'requireTeamPage',

  // Project membership.
  '/projects/[id]': 'requireProjectAccess',
  '/projects/[id]/execute': 'requireProjectAccess',
  '/projects/[id]/explore': 'requireProjectAccess',
  '/projects/[id]/plan': 'requireProjectAccess',
  '/projects/[id]/reflect': 'requireProjectAccess',
  '/projects/[id]/review': 'requireProjectAccess',
  '/projects/[id]/spec': 'requireProjectAccess',

  // Admin surfaces. These are the ones a missing line silently exposes.
  '/loops': 'requireAdmin',
  '/loops/activity': 'requireAdmin',
  '/settings/members': 'requireTeamAdminPage',
  '/settings/team': 'requireTeamAdminPage',
  '/settings/components': 'requireOrgAdmin',
  '/settings/components/[slotId]': 'requireOrgAdmin',
  '/settings/components/[slotId]/[variantId]': 'requireOrgAdmin',
  '/settings/connections': 'requireOrgAdmin',
  '/settings/models': 'requireOrgAdmin',
  '/settings/org': 'requireOrgAdmin',
  '/usage/loops': 'requireAdmin',
  '/usage/projects': 'requireAdmin',
  '/usage/standalone': 'requireAdmin',
};

function pages(dir = 'app'): Array<{ route: string; file: string }> {
  const out: Array<{ route: string; file: string }> = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.next')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...pages(p));
    else if (e.name === 'page.tsx') {
      out.push({ route: dir.slice('app'.length).replace(/\/\([^)]*\)/g, '') || '/', file: p });
    }
  }
  return out;
}

const all = pages();

describe('every page declares the scope it needs', () => {
  it('found the pages', () => {
    expect(all.length).toBeGreaterThan(25);
    expect(all.map((p) => p.route)).toContain('/settings/org');
  });

  it('has an entry for every page', () => {
    const undeclared = all.filter((p) => !(p.route in GUARD)).map((p) => `${p.route} (${p.file})`);
    expect(
      undeclared,
      'add the route to GUARD with the guard it calls, or "session" if the layout gate is the whole requirement',
    ).toEqual([]);
  });

  it('has no entry for a page that no longer exists', () => {
    const routes = new Set(all.map((p) => p.route));
    expect(Object.keys(GUARD).filter((r) => !routes.has(r))).toEqual([]);
  });

  it('actually calls the guard it declares', () => {
    const lying = all.filter((p) => {
      const guard = GUARD[p.route];
      if (!guard || guard === 'session') return false;
      return !readFileSync(p.file, 'utf8').includes(guard);
    });
    expect(lying.map((p) => p.route), 'the declared guard is not called in the page').toEqual([]);
  });

  /**
   * The layout's session gate is what makes `'session'` safe. If it stops redirecting,
   * every page in the group opens up at once — including the three declared `'session'`.
   */
  it('the (app) layout still gates the whole group', () => {
    const layout = readFileSync('app/(app)/layout.tsx', 'utf8');
    expect(layout).toContain('currentMember');
    expect(layout).toMatch(/redirect\(['"]\/login['"]\)/);
  });

  /** An admin page that loses its guard is the expensive mistake — name them explicitly. */
  it('every admin surface names an admin guard', () => {
    const ADMIN_GUARDS = ['requireOrgAdmin', 'requireTeamAdminPage', 'requireAdmin'];
    const adminRoutes = all
      .map((p) => p.route)
      .filter((r) => r.startsWith('/settings/') || r.startsWith('/loops') || r.startsWith('/usage/'))
      .filter((r) => !['/settings', '/settings/guide', '/settings/guide/[sectionId]'].includes(r));

    const weak = adminRoutes.filter((r) => !ADMIN_GUARDS.includes(GUARD[r] ?? ''));
    expect(weak, 'an admin surface must not fall back to the layout session gate').toEqual([]);
  });
});
