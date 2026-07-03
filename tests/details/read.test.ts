import { describe, it, expect } from 'vitest';
import { buildInitialDetails } from '@/details/schema';
import { getCurrentPhase, getRepos, getBriefText } from '@/details/read';

describe('getCurrentPhase', () => {
  it('returns the active phase within a stage', () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.status = 'done';
    d.stages.exploration.phases.discover.status = 'active';
    expect(getCurrentPhase(d, 'exploration')).toBe('discover');
  });

  it('returns null when no phase is active', () => {
    const d = buildInitialDetails();
    expect(getCurrentPhase(d, 'spec')).toBeNull();
  });
});

describe('getRepos', () => {
  it('returns empty repos initially', () => {
    expect(getRepos(buildInitialDetails())).toEqual([]);
  });

  it('returns repos when populated', () => {
    const d = buildInitialDetails();
    d.repos = [{ id: 'r1', name: 'repo', pathOnDisk: '/tmp', defaultBranch: 'main' }];
    expect(getRepos(d)).toHaveLength(1);
    expect(getRepos(d)[0].name).toBe('repo');
  });
});

describe('getBriefText', () => {
  it('returns empty brief initially', () => {
    expect(getBriefText(buildInitialDetails())).toBe('');
  });

  it('returns brief text when set', () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.text = 'my idea';
    expect(getBriefText(d)).toBe('my idea');
  });
});
