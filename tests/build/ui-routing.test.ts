// @vitest-environment node
import { projectIndexTarget } from '@/projects/index-target';

describe('projectIndexTarget (F11)', () => {
  it('routes build/learn phases to their current stage', () => {
    expect(projectIndexTarget('p1', 'build', 'plan')).toBe('/projects/p1/plan');
    expect(projectIndexTarget('p1', 'learn', 'review')).toBe('/projects/p1/review');
  });

  it('routes pre-build phases to their current stage', () => {
    expect(projectIndexTarget('p1', 'design', 'exploration')).toBe('/projects/p1/explore');
    expect(projectIndexTarget('p1', 'design', 'spec')).toBe('/projects/p1/spec');
  });
});
