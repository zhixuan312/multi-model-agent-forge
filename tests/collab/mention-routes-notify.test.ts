// @vitest-environment node
/**
 * Every route that accepts a discussion message notifies the people it mentions.
 *
 * `notifyMentions` being correct is worth nothing if a route forgets to call it, and that
 * is the likely failure: the two message routes are near-copies of each other, so a third
 * one added by copying either would inherit whichever was missed. The unit test above proves
 * the helper; this proves it is reached.
 *
 * Deliberately a source check, not a behavioural one. A behavioural test needs the full
 * Next request/auth/db stack per route, which is why the ORIGINAL gap — an @-autocomplete
 * wired to nothing — survived a suite that tested mention parsing thoroughly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function messageRoutes(dir = 'app/api/projects', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) messageRoutes(p, out);
    else if (e.name === 'route.ts' && dir.endsWith('/message')) out.push(p);
  }
  return out;
}

describe('discussion message routes notify mentions', () => {
  const routes = messageRoutes();

  it('found the message routes', () => {
    // Spec component + plan task. A new one must be added deliberately, not by accident.
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.some((r) => r.includes('spec/components'))).toBe(true);
    expect(routes.some((r) => r.includes('plan/tasks'))).toBe(true);
  });

  it('every message route calls notifyMentions', () => {
    const silent = routes.filter((r) => !readFileSync(r, 'utf8').includes('notifyMentions('));
    expect(silent, 'a route that accepts @-mentions and notifies nobody makes the composer’s autocomplete a lie').toEqual([]);
  });

  /** The author and their team decide who can be resolved — passing the wrong one either
   *  notifies nobody or reaches outside the team. */
  it('passes the caller’s own identity and team scope', () => {
    for (const r of routes) {
      const src = readFileSync(r, 'utf8');
      const call = src.slice(src.indexOf('notifyMentions('));
      expect(call, `${r} must attribute the mention to the caller`).toContain('authorId: me.id');
      expect(call, `${r} must scope the pool to the caller's team`).toContain('teamId: me.teamId');
    }
  });
});
