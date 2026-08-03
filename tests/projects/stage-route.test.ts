import { STAGE_ROUTE, SEGMENT_TO_STAGE, stageRoute } from '@/projects/stage-route';
import { STAGE_KIND } from '@/db/enums';

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
