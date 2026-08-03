import { describe, expect, it, vi } from 'vitest';

const { dispatchMma, findInflight, updateDetails } = vi.hoisted(() => ({
  dispatchMma: vi.fn(async () => ({ batchRowId: 'b1' })),
  findInflight: vi.fn(async () => null),
  updateDetails: vi.fn(async () => {}),
}));
vi.mock('@/dispatch/dispatch-helpers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  dispatchMma,
  findInflight,
}));
vi.mock('@/details/write', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  updateDetails,
}));
vi.mock('@/projects/project-workspace', () => ({
  resolveProjectWorkspaceRoot: async () => '/tmp/ws',
}));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: async () => ({}) }));

import { executeDetailsAction } from '@/automation/details-actions';
import type { AutoAction } from '@/automation/details-resolver';
import { createMockDb } from '../test-utils/mock-db';

/**
 * `validate_task` dispatches a plan-task review to MMA. The REVIEWER'S verdict is
 * posted to the task chat by the `plan-refine` terminal handler, which reads the
 * real envelope (`result.chatReply`).
 *
 * So `validate_task` itself must author no verdict. It used to insert a second,
 * hardcoded message — "Task reviewed — no critical issues found." — unconditionally,
 * so a task the reviewer had just flagged still showed the user a clean bill of
 * health from Forge, one message below the real findings.
 */
describe('validate_task does not author its own verdict', () => {
  const action = {
    kind: 'validate_task',
    note: '',
    stage: 'plan',
    phase: 'refine',
    data: { taskId: 't1', taskTitle: 'Add the widget' },
  } as AutoAction;

  /** Every `bodyMd` this action wrote to the task chat. */
  async function chatBodies(): Promise<string[]> {
    const db = createMockDb();
    await executeDetailsAction('p', action, db);
    return db._calls
      .filter((c) => c.method === 'values')
      .flatMap((c) => c.args)
      .filter((v): v is { bodyMd?: unknown } => typeof v === 'object' && v !== null)
      .map((v) => (typeof v.bodyMd === 'string' ? v.bodyMd : ''))
      .filter(Boolean);
  }

  it('posts only the review REQUEST, leaving the verdict to the terminal handler', async () => {
    const bodies = await chatBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/review/i);
  });

  it('claims no outcome — nothing it writes asserts the review passed', async () => {
    for (const body of await chatBodies()) {
      // Past-tense/clean-verdict language means this action is reporting a result it
      // never read. Any such claim here is a fabrication: the envelope is not consulted.
      expect(body, body).not.toMatch(/no (critical |major )?issues|reviewed —|looks good|passed|all clear/i);
    }
  });
});
