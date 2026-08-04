import { STAGE_ROUTE, SEGMENT_TO_STAGE, stageRoute } from '@/projects/stage-route';
import { STAGE_KIND } from '@/db/enums';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('stage-route', () => {
  // Two kinds diverge from their enum name in the URL: `exploration` reads as
  // "explore", and `journal` reads as "reflect" (matching STAGE_LABEL.journal).
  // Every other kind is identity-segmented.
  const RENAMED: Partial<Record<(typeof STAGE_KIND)[number], string>> = {
    exploration: 'explore',
    journal: 'reflect',
  };

  it('maps the two renamed kinds and stays identity for the rest', () => {
    expect(STAGE_ROUTE.exploration).toBe('explore');
    expect(STAGE_ROUTE.journal).toBe('reflect');
    for (const kind of STAGE_KIND) {
      expect(STAGE_ROUTE[kind]).toBe(RENAMED[kind] ?? kind);
    }
  });

  it('stageRoute(exploration, id) → /projects/<id>/explore (never /exploration)', () => {
    expect(stageRoute('exploration', 'abc')).toBe('/projects/abc/explore');
    expect(stageRoute('exploration', 'abc')).not.toContain('exploration');
  });

  it('stageRoute is identity-segmented for the other kinds', () => {
    expect(stageRoute('spec', 'p1')).toBe('/projects/p1/spec');
    expect(stageRoute('plan', 'p1')).toBe('/projects/p1/plan');
    expect(stageRoute('execute', 'p1')).toBe('/projects/p1/execute');
    expect(stageRoute('review', 'p1')).toBe('/projects/p1/review');
  });

  it('stageRoute(journal, id) → /projects/<id>/reflect (never /journal)', () => {
    expect(stageRoute('journal', 'abc')).toBe('/projects/abc/reflect');
    expect(stageRoute('journal', 'abc')).not.toContain('journal');
  });

  it('SEGMENT_TO_STAGE round-trips every kind, so the two directions cannot drift', () => {
    // AutomationGate and LiveStageStepper each used to carry their own copy of this
    // relationship — one forward, one inverse. Derived from STAGE_ROUTE, that is impossible.
    for (const kind of STAGE_KIND) {
      expect(SEGMENT_TO_STAGE[STAGE_ROUTE[kind]]).toBe(kind);
    }
    expect(Object.keys(SEGMENT_TO_STAGE)).toHaveLength(STAGE_KIND.length);
  });

  it('maps the renamed segments back to their enum kind', () => {
    expect(SEGMENT_TO_STAGE.explore).toBe('exploration');
    expect(SEGMENT_TO_STAGE.reflect).toBe('journal');
  });
});

/**
 * The map must name segments that EXIST.
 *
 * Every assertion above is about the constant's own shape: that it is total over
 * `STAGE_KIND`, that the inverse round-trips, that two kinds are renamed. All of that
 * stays true if someone renames `app/(app)/projects/[id]/reflect/` to `journal/` — the
 * map would keep saying `reflect`, `tsc` would stay green, and every Reflect link in the
 * product would 404. A route segment is a claim about the filesystem, and no type can
 * check it.
 *
 * Asserted BOTH ways, because a one-way check has an incomplete domain: map→disk misses a
 * stage page nothing routes to, and disk→map misses a segment pointing at nothing.
 */
describe('every stage segment resolves to a real page', () => {
  const STAGE_DIR = 'app/(app)/projects/[id]';

  it('each STAGE_ROUTE segment has a page.tsx on disk', () => {
    for (const kind of STAGE_KIND) {
      const seg = STAGE_ROUTE[kind];
      expect(
        existsSync(join(STAGE_DIR, seg, 'page.tsx')),
        `${kind} routes to /${seg}, which has no page.tsx`,
      ).toBe(true);
    }
  });

  it('no stage page exists that the map does not route to', () => {
    const onDisk = readdirSync(STAGE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(STAGE_DIR, e.name, 'page.tsx')))
      .map((e) => e.name);
    const routed = new Set(Object.values(STAGE_ROUTE));
    expect(onDisk.filter((d) => !routed.has(d)), 'a stage page nothing links to').toEqual([]);
    // Guard the guard: an empty read would satisfy the line above vacuously.
    expect(onDisk.length).toBe(STAGE_KIND.length);
  });
});
