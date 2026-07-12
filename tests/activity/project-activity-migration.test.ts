import { describe, expect, it } from 'vitest';
import {
  buildLegacyActivityBackfillRows,
  buildForgeMemberSeed,
  type LegacyProjectEvent,
} from '@/activity/project-activity-migration';

const projectId = 'proj-1';

function row(overrides: Partial<LegacyProjectEvent> = {}): LegacyProjectEvent {
  return {
    stage: 'spec',
    phase: 'craft',
    detail: 'Drafted spec',
    kind: 'done',
    durationMs: 1200,
    at: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('project-activity migration helpers', () => {
  it('preserves chronological order and synthetic backfill keys', () => {
    const rows = buildLegacyActivityBackfillRows(projectId, [
      row({ detail: 'Later row', at: '2026-07-10T00:00:02.000Z' }),
      row({ detail: 'Earlier row', at: '2026-07-10T00:00:01.000Z' }),
      row({ detail: 'Same timestamp but later index', at: '2026-07-10T00:00:02.000Z' }),
    ]);

    expect(rows.map((r) => r.label)).toEqual([
      'Earlier row',
      'Later row',
      'Same timestamp but later index',
    ]);
    expect(rows.map((r) => r.eventKey)).toEqual([
      'backfill:proj-1:0',
      'backfill:proj-1:1',
      'backfill:proj-1:2',
    ]);
  });

  it('backfills every row with uniform Forge attribution and mma source', () => {
    const [only] = buildLegacyActivityBackfillRows(projectId, [row()]);
    expect(only.actorId).toBe('00000000-0000-0000-0000-000000000000');
    expect(only.actorName).toBe('Forge');
    expect(only.actorTint).toBe('#9a6b4f');
    expect(only.source).toBe('mma');
  });

  it('is idempotent for the same legacy inputs', () => {
    const legacy = [row(), row({ detail: 'Audited spec', at: '2026-07-10T00:00:03.000Z' })];
    expect(buildLegacyActivityBackfillRows(projectId, legacy)).toEqual(
      buildLegacyActivityBackfillRows(projectId, legacy),
    );
  });

  it('builds a single global Forge member seed row (org_admin, null team)', () => {
    expect(buildForgeMemberSeed()).toEqual({
      id: '00000000-0000-0000-0000-000000000000',
      username: 'forge',
      displayName: 'Forge',
      avatarTint: '#9a6b4f',
      role: 'org_admin',
      teamId: null,
    });
  });
});
