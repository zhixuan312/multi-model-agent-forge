import { STAGE_ROUTE, stageRoute, DATA_PHASE } from '@/projects/stage-route';
import { STAGE_KIND, PROJECT_PHASE } from '@/db/enums';

describe('stage-route', () => {
  it('maps exploration → explore (the one divergence) and identity for the rest', () => {
    expect(STAGE_ROUTE.exploration).toBe('explore');
    for (const kind of STAGE_KIND) {
      if (kind === 'exploration') continue;
      expect(STAGE_ROUTE[kind]).toBe(kind);
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

  it('DATA_PHASE maps each project phase to design or build (two CSS worlds)', () => {
    expect(DATA_PHASE.design).toBe('design');
    expect(DATA_PHASE.build).toBe('build');
    expect(DATA_PHASE.learn).toBe('build');
    for (const phase of PROJECT_PHASE) {
      expect(['design', 'build']).toContain(DATA_PHASE[phase]);
    }
  });
});
