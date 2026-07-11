// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { usageOverview } from '@/usage/usage-core';
import { createMockDb } from '../test-utils/mock-db';

const batch = { id: 'b1', teamId: 'team-a', route: 'delegate', status: 'done', costUsd: 1.25, savedVsMainUsd: 2.5, inputTokens: 100, outputTokens: 50, durationMs: 1200, createdAt: new Date(), projectId: null };

describe('team usage aggregations', () => {
  it('filters overview by teamId', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [batch] });
    const result = await usageOverview('month', { db, teamId: 'team-b' });
    expect(result.metrics.taskCount).toBe(0);
  });

  it('returns a daily trend series for the chart', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': [{ date: '2026-07-01', costUsd: 1.25, savedUsd: 2.5, count: 3 }],
    });
    const result = await usageOverview('month', { db, teamId: 'team-a' });
    expect(Array.isArray(result.trend)).toBe(true);
    expect(result.trend[0]).toMatchObject({ date: '2026-07-01', costUsd: 1.25, savedUsd: 2.5, count: 3 });
  });
});
