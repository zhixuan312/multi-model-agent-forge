// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { usageOverview } from '@/usage/usage-core';
import { createMockDb } from '../test-utils/mock-db';

describe('org usage rollup', () => {
  it('returns headline, costByTeam, infraBreakdown, trend, and teamDrilldown using only ops_mma_batch facts', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': [{ id: 'b1', teamId: 'team-a', route: 'delegate', status: 'done', costUsd: 3, savedVsMainUsd: 6, inputTokens: 100, outputTokens: 50, durationMs: 500, implementerModel: 'gpt-5', reviewerModel: null, implementerTier: 'standard', createdAt: new Date() }],
      'select:team': [{ id: 'team-a', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: null }],
      'select:team_member': [{ count: 2 }],
    });
    const result = await usageOverview('month', { db, scope: 'org' } as never);
    expect(result).toHaveProperty('headline');
    expect(result).toHaveProperty('costByTeam');
    expect(result).toHaveProperty('infraBreakdown');
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('teamDrilldown');
    expect(JSON.stringify(result)).not.toContain('projectName');
    expect(JSON.stringify(result)).not.toContain('repoName');
  });
});
