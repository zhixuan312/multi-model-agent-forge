// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture what executeDetailsAction receives so we can assert on the effect payload,
// and a mutable automation status so each test picks the right gate (auto requires
// running; manual requires not-running).
const { executeDetailsAction, state } = vi.hoisted(() => ({
  executeDetailsAction: vi.fn(async () => 'ok' as const),
  state: { automationStatus: 'running' as 'running' | 'off' },
}));
vi.mock('@/automation/details-actions', () => ({ executeDetailsAction }));

// Minimal, deterministic stand-ins for the gate machinery so the test exercises
// ONLY performTransition's actorId-threading rule (manual injects the member id;
// auto never leaks the driver lease id into the effect payload).
vi.mock('@/details/schema', () => ({
  validateDetails: () => ({ automation: { status: state.automationStatus } }),
}));
vi.mock('@/automation/stage-repair', () => ({ repairActiveStage: () => ({ changed: false }) }));
vi.mock('@/details/write', () => ({
  deriveCurrentStage: vi.fn(async () => {}),
  updateDetails: vi.fn(async () => {}),
}));
vi.mock('@/automation/allowed-actions', () => ({
  allowedActions: () => [{ kind: 'advance_phase', stage: 'spec', phase: 'craft', note: 'Continue', data: {} }],
}));
vi.mock('@/automation/driver-lease', () => ({ DRIVER_LEASE_STALE_MS: 30_000 }));

import { performTransition } from '@/automation/perform-transition';
import { createMockDb } from '../test-utils/mock-db';

function db() {
  return createMockDb({ 'select:project': [{ details: {}, autoMode: true }] });
}

function capturedActionData(): { actorId?: unknown } | undefined {
  const call = executeDetailsAction.mock.calls[0] as unknown as [string, { data?: { actorId?: unknown } }, unknown];
  return call?.[1]?.data;
}

describe('performTransition — actor attribution threading', () => {
  beforeEach(() => executeDetailsAction.mockClear());

  it('auto mode never leaks the driver lease id into the effect payload (attribution stays Forge/mma)', async () => {
    state.automationStatus = 'running';
    await performTransition(db(), 'proj-1', { kind: 'advance_phase' }, { mode: 'auto', actorId: 'driver-lease-uuid' });
    // The driver lease id is used ONLY for the lease-freshness check, never as the
    // acting member — so the effect payload carries no actorId, and the activity
    // seam defaults it to FORGE_MEMBER_ID → source='mma'.
    expect(capturedActionData()?.actorId).toBeUndefined();
  });

  it('manual mode threads the human member id into the effect payload', async () => {
    state.automationStatus = 'off';
    await performTransition(db(), 'proj-1', { kind: 'advance_phase' }, { mode: 'manual', actorId: 'member-1' });
    expect(capturedActionData()?.actorId).toBe('member-1');
  });
});
