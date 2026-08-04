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

  /**
   * The routes are now thin adapters over `postQaMessage`, so the chain is asserted once,
   * where it lives, and each route is checked for delegating to it.
   *
   * This file's own docstring predicted the problem it now no longer has to guard: "the two
   * message routes are near-copies of each other, so a third one added by copying either
   * would inherit whichever was missed". They were byte-identical apart from three values
   * and their comments. Ratcheting the symptom was the wrong half of the fix — a copy that
   * satisfies a grep is still a copy, and the next one would have satisfied it too.
   */
  it('every message route delegates to the one shared implementation', () => {
    const rogue = routes.filter((r) => !readFileSync(r, 'utf8').includes('postQaMessage('));
    expect(rogue, 'a message route that hand-rolls the chain will drift from the others').toEqual([]);
  });

  it('the shared implementation notifies mentions, with the caller’s identity and team scope', () => {
    const src = readFileSync('src/collab/post-qa-message.ts', 'utf8');
    expect(src).toContain('notifyMentions(');
    const call = src.slice(src.indexOf('notifyMentions('));
    expect(call, 'the mention must be attributed to the caller').toContain('authorId: me.id');
    expect(call, "the pool must be scoped to the caller's team").toContain('teamId: me.teamId');
  });

  it('the shared implementation guards, bounds and publishes before it notifies', () => {
    // Each of these was, at some point, missing from one of the two copies.
    const src = readFileSync('src/collab/post-qa-message.ts', 'utf8');
    expect(src, 'unguarded, any authed member could post into another team’s chat').toContain('guardProjectWrite(');
    expect(src, 'an unbounded body goes into a text column and out over SSE').toContain('parseQaMessageBody(');
    expect(
      src.indexOf('projectEventBus.publish'),
      'a committed message must not be failed by the notification fan-out',
    ).toBeLessThan(src.indexOf('await notifyMentions('));
  });
});
