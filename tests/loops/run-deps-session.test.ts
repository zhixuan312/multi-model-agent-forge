// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const { dispatchMma } = vi.hoisted(() => ({
  dispatchMma: vi.fn(async (_o: unknown) => ({
    batchRowId: 'b1',
    envelope: {
      output: { summary: '{"recalls":[],"verifyCommand":null}' },
      execution: { sessions: { implementer: 'sess-from-engine', reviewer: null } },
    },
  })),
}));
vi.mock('@/dispatch/dispatch-helpers', () => ({ dispatchMma, findInflight: async () => null }));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: async () => ({}) }));
vi.mock('@/secrets/secret-store', () => ({ PostgresSecretStore: { create: async () => ({ get: async () => 'tok' }) } }));

import { buildLoopRunDeps } from '@/loops/run-deps';
import { createMockDb } from '../test-utils/mock-db';

/**
 * The engine reports the session it used on the terminal envelope
 * (`execution.sessions.implementer`) and accepts one back under `sessionIds.implementer`.
 * This adapter used to send neither and hardcode `sessionId: null`, so the loop's journal
 * turn could never resume the plan turn — while three docs said it did.
 */
describe('the main-session adapter speaks both halves of the session exchange', () => {
  const deps = async () =>
    buildLoopRunDeps({ id: 'team-1', workspaceRootPath: '/w' } as never, { db: createMockDb() });

  it("returns the engine's session id rather than null", async () => {
    const d = await deps();
    const turn = await d.mainSession({ cwd: '/w/r', prompt: 'plan please' });
    expect(turn.sessionId).toBe('sess-from-engine');
  });

  it('sends a supplied session id back for the engine to resume', async () => {
    dispatchMma.mockClear();
    const d = await deps();
    await d.mainSession({ cwd: '/w/r', prompt: 'journal please', sessionId: 'sess-1' });
    const body = (dispatchMma.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body.sessionIds).toEqual({ implementer: 'sess-1' });
  });

  it('omits sessionIds entirely when there is nothing to resume', async () => {
    dispatchMma.mockClear();
    const d = await deps();
    await d.mainSession({ cwd: '/w/r', prompt: 'plan please' });
    const body = (dispatchMma.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty('sessionIds');
  });
});
