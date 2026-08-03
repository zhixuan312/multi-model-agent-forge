// @vitest-environment node
/**
 * FR-7: the activity line names WHO caused the work, and whether it was a person or the
 * agent. `exploration/dispatch.ts` states the rule — "auto driver → Forge/'mma', human →
 * member/'user'" — and derives both from the triggering actor.
 *
 * `dispatchMma`, the centralised dispatcher every other stage goes through, hardcoded
 * `FORGE_ACTOR` and `source: 'mma'`. The project timeline renders that name and its tint
 * dot (`SummaryPhase`), so a person who clicked "Run spec audit" watched Forge take the
 * credit. Two writers of one activity log, following the same numbered requirement two
 * different ways.
 */
import { vi } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';
import { FORGE_MEMBER_ID, FORGE_DISPLAY_NAME } from '@/automation/forge-member';

const recorded: Array<{ actor: { id: string; name: string }; source: string; kind: string }> = [];
vi.mock('@/activity/project-activity', () => ({
  recordActivity: vi.fn(async (input: { actor: { id: string; name: string }; source: string; kind: string }) => {
    recorded.push(input);
  }),
  resolveRunningActivity: vi.fn(async () => 0),
}));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: vi.fn(async () => ({ dispatch: async () => ({ batchId: 'mma-1' }) })) }));
vi.mock('@/sse/poll-manager', () => ({ getPollManager: () => ({ register: vi.fn(), isRegistered: () => true }) }));

const { dispatchMma } = await import('@/dispatch/dispatch-helpers');

function db(actorRow?: { displayName: string; avatarTint: string }) {
  return createMockDb({
    'select:project': [{ teamId: 't1' }],
    'select:team_member': actorRow ? [actorRow] : [],
    'insert:ops_mma_batch': [{ id: 'row-1', createdAt: new Date() }],
    'update:ops_mma_batch': [{ id: 'row-1' }],
  });
}

const dispatch = (actorId: string | null, d: ReturnType<typeof db>) =>
  dispatchMma({
    db: d as never, mma: { dispatch: async () => ({ batchId: 'mma-1' }) } as never,
    projectId: 'p1', route: 'audit', handler: 'spec-audit', cwd: '/w',
    body: { prompt: 'x' }, actorId,
  });

beforeEach(() => { recorded.length = 0; });

describe('who the running activity line credits', () => {
  it('credits the member who triggered it, as user work', async () => {
    await dispatch('member-7', db({ displayName: 'Bo Chen', avatarTint: '#355a74' }));
    const running = recorded.find((r) => r.kind === 'running');
    expect(running?.actor).toMatchObject({ id: 'member-7', name: 'Bo Chen' });
    expect(running?.source).toBe('user');
  });

  it('credits Forge, as agent work, when the driver dispatched it', async () => {
    await dispatch(FORGE_MEMBER_ID, db());
    const running = recorded.find((r) => r.kind === 'running');
    expect(running?.actor.name).toBe(FORGE_DISPLAY_NAME);
    expect(running?.source).toBe('mma');
  });

  it('falls back to Forge when there is no actor at all', async () => {
    await dispatch(null, db());
    expect(recorded.find((r) => r.kind === 'running')?.source).toBe('mma');
  });

  it('falls back to Forge when the actor id resolves to no member', async () => {
    await dispatch('ghost', db());
    expect(recorded.find((r) => r.kind === 'running')?.source).toBe('mma');
  });
});
