// @vitest-environment node
/**
 * Every route Forge can dispatch has a page in the Guide.
 *
 * The Guide is the in-product manual for the engine, and it documented eleven task types
 * while `orchestrate` — a real type, on the `main` tier, with ten Forge dispatch sites —
 * had no page at all. That is the worst shape for a manual gap: the route with no page was
 * the one running BETWEEN the stages a reader can see, so the parts of the pipeline they
 * could not account for were exactly the parts nothing explained.
 *
 * Nothing caught it because a missing page is an absence, and prose cannot be diffed against
 * an enum by eye. `MMA_ROUTE` is the list of routes Forge actually dispatches, so it is the
 * right authority: adding a route to it now requires writing the page too.
 *
 * One direction only. The Guide legitimately documents `debug`, an engine route Forge does
 * not dispatch — the manual describing more of the engine than Forge uses is a feature.
 */
import { DIRECTION_SECTIONS } from '@/content/direction-sections';
import { MMA_ROUTE } from '@/db/enums';

/** `tool-execute-plan` ← `execute_plan`: ids are kebab, route names are snake. */
const pageId = (route: string) => `tool-${route.replace(/_/g, '-')}`;

describe('the Guide covers every dispatchable route', () => {
  const ids = new Set(DIRECTION_SECTIONS.map((s) => s.id));

  it('found the sections and the routes', () => {
    expect(DIRECTION_SECTIONS.length).toBeGreaterThan(20);
    expect(MMA_ROUTE.length).toBeGreaterThanOrEqual(11);
    // A broken id convention would make every lookup miss and the suite pass vacuously.
    expect(ids).toContain('tool-audit');
  });

  it('has a page for each route in MMA_ROUTE', () => {
    const missing = MMA_ROUTE.filter((r) => !ids.has(pageId(r)));
    expect(missing, 'add a DIRECTION_SECTIONS entry — a route Forge dispatches with no page is an undocumented part of the pipeline').toEqual([]);
  });

  /**
   * A page that says nothing about where the route runs is not documentation. Each route
   * page carries an "In the code" pointer, which is what makes the claim checkable.
   */
  it('every route page points at the code that implements it', () => {
    const missing = MMA_ROUTE
      .map((r) => DIRECTION_SECTIONS.find((s) => s.id === pageId(r)))
      .filter((s) => s && !s.underTheHood)
      .map((s) => s!.id);
    expect(missing, 'a route page needs an `underTheHood` source pointer').toEqual([]);
  });

  /**
   * Body length alone is the WRONG measure and this test says so explicitly, because the
   * first version of it failed `review` and `investigate` — two perfectly complete pages
   * whose prose is a one-line lead-in to a criteria table. A page carries its content in the
   * body OR in a structured renderer; requiring both would push padding into the ones that
   * correctly delegate.
   */
  it('every route page actually says something — in prose or in a renderer', () => {
    const empty = MMA_ROUTE
      .map((r) => DIRECTION_SECTIONS.find((s) => s.id === pageId(r)))
      .filter((s) => s && !s.routeKey && !s.component && s.body.length < 200)
      .map((s) => s!.id);
    expect(empty, 'a page with no criteria table and no component needs a real body').toEqual([]);
  });
});
