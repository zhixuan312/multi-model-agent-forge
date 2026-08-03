// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/details/write', () => ({ updateDetails: vi.fn(async () => {}) }));
vi.mock('@/projects/project-files', () => ({
  readPlanFile: async () => ({ version: 1, updatedAt: '', bodyMd: '# Plan\n\n### Task 1: A\n\nx\n' }),
}));
vi.mock('@/spec/audit-loop', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  nextPassNo: async () => 1,
}));

import { projectEventBus } from '@/sse/event-bus';
import { getHandler, ensureHandlersRegistered } from '@/dispatch/handler-registry';
import { createMockDb } from '../test-utils/mock-db';

/**
 * Auto-driven work is dispatched SERVER-side, so the client's `onDone` tracking never
 * fires. `spec-audit` publishes `spec.updated` for exactly that reason, with a comment
 * saying so — and the plan handlers published nothing, so a plan audit driven by
 * automation left the Validate rail stale until a manual reload.
 */
const auditEnvelope = {
  output: { summary: { findings: [{ severity: 'low', category: 'x', claim: 'y' }] }, contextBlockId: null },
};

async function eventsFrom(handler: string, envelope: unknown): Promise<string[]> {
  const seen: string[] = [];
  const unsub = projectEventBus.subscribe('p1', (e) => { seen.push(e.type); });
  try {
    await ensureHandlersRegistered();
    await getHandler(handler)!(
      createMockDb({ 'select:project': [{ details: null }] }),
      { batchRowId: 'b1', projectId: 'p1', handler, request: {}, actorId: null },
      envelope,
    );
  } finally {
    unsub();
  }
  return seen;
}

describe('the Plan stage announces server-side changes', () => {
  it('plan-audit publishes a stage refresh', async () => {
    expect(await eventsFrom('plan-audit', auditEnvelope)).toContain('plan.stage_updated');
  });

  it('plan-audit-apply publishes a stage refresh', async () => {
    expect(await eventsFrom('plan-audit-apply', {})).toContain('plan.stage_updated');
  });
});
