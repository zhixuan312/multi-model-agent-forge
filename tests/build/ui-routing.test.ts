// @vitest-environment node
import { projectIndexTarget } from '@/projects/index-target';

describe('projectIndexTarget (F11)', () => {
  it('redirects build/done phases to /build', () => {
    expect(projectIndexTarget('p1', 'build', 'plan')).toBe('/projects/p1/build');
    expect(projectIndexTarget('p1', 'done', 'review')).toBe('/projects/p1/build');
  });

  it('routes pre-build phases to their current stage (not /build)', () => {
    expect(projectIndexTarget('p1', 'design', 'exploration')).toBe('/projects/p1/explore');
    expect(projectIndexTarget('p1', 'frozen', 'spec')).toBe('/projects/p1/spec');
  });
});
