// @vitest-environment node
import {
  freezeProject,
  canFreeze,
  recordAuditOverride,
  FreezeIrreversibleError,
} from '@/spec/freeze';
import { createMockDb, seq } from '../test-utils/mock-db';

describe('canFreeze (the verdict-or-override gate, F5/F26)', () => {
  it('false when no audit has run', async () => {
    const projectId = 'proj-1';
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
    });
    expect(await canFreeze(mockDb, projectId)).toBe(false);
  });

  it('true when the latest pass is clean', async () => {
    const projectId = 'proj-2';
    const mockDb = createMockDb({
      'select:project_audit_pass': [
        { id: 'pass-2', projectId, scope: 'spec', passNo: 2, verdict: 'clean', findingsCount: 0 },
        { id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'revised', findingsCount: 1 },
      ],
    });
    expect(await canFreeze(mockDb, projectId)).toBe(true);
  });

  it('false when the latest pass is revised and no override', async () => {
    const projectId = 'proj-3';
    const mockDb = createMockDb({
      'select:project_audit_pass': [
        { id: 'pass-2', projectId, scope: 'spec', passNo: 2, verdict: 'revised', findingsCount: 1 },
        { id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'clean', findingsCount: 0 },
      ],
      'select:audit_override': [],
    });
    expect(await canFreeze(mockDb, projectId)).toBe(false);
  });

  it('true with a revised latest pass IF an audit_override row exists (F26)', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    const mockDb = createMockDb({
      'select:project_audit_pass': [
        { id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'revised', findingsCount: 1 },
      ],
      'select:ops_action_log': seq([], [{ id: 'override-1', projectId, memberId: ownerId }]),
      'insert:ops_action_log': [{ id: 'override-1', projectId, memberId: ownerId, action: 'audit_override' }],
    });
    expect(await canFreeze(mockDb, projectId)).toBe(false);
    await recordAuditOverride(projectId, ownerId, { db: mockDb });
    expect(await canFreeze(mockDb, projectId)).toBe(true);
  });
});

describe('freezeProject', () => {
  it('design→build transactionally: phase, frozen_at, stage done, ops_action_log', async () => {
    const projectId = 'proj-5';
    const ownerId = 'owner-5';
    const frozenAt = new Date();

    const mockDb = createMockDb({
      'select:project_audit_pass': [{ id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'clean', findingsCount: 0 }],
      'select:audit_override': [],
      'select:project': [{ id: projectId, phase: 'design', frozenAt: null }],
      'update:project': [{ id: projectId, phase: 'build', frozenAt }],
      'select:project_stage': [{ projectId, kind: 'spec', status: 'active' }],
      'update:project_stage': [{ projectId, kind: 'spec', status: 'done' }],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'freeze', memberId: ownerId }],
    });

    const res = await freezeProject(projectId, ownerId, { db: mockDb });
    expect(res).toEqual({ ok: true, alreadyFrozen: false });
  });

  it('blocked (not_clean) when latest verdict is not clean and no override', async () => {
    const projectId = 'proj-6';
    const ownerId = 'owner-6';

    const mockDb = createMockDb({
      'select:project_audit_pass': [
        { id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'revised', findingsCount: 1 },
      ],
      'select:audit_override': [],
      'select:project': [{ id: projectId, phase: 'design' }],
    });

    const res = await freezeProject(projectId, ownerId, { db: mockDb });
    expect(res).toEqual({ ok: false, reason: 'not_clean' });
  });

  it('irreversibility guard: a second freeze is a no-op (alreadyFrozen), not a re-freeze', async () => {
    const projectId = 'proj-7';
    const ownerId = 'owner-7';
    const frozenAt = new Date('2026-01-01');

    const mockDb = createMockDb({
      'select:project_audit_pass': seq(
        [{ id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'clean', findingsCount: 0 }],
        [{ id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'clean', findingsCount: 0 }],
      ),
      'select:audit_override': seq([], []),
      'select:project': seq(
        [{ id: projectId, phase: 'design', frozenAt: null }],
        [{ id: projectId, phase: 'build', frozenAt }],
      ),
      'update:project': [{ id: projectId, phase: 'build', frozenAt }],
      'select:project_stage': [{ projectId, kind: 'spec', status: 'active' }],
      'update:project_stage': [{ projectId, kind: 'spec', status: 'done' }],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'freeze', memberId: ownerId }],
    });

    const res1 = await freezeProject(projectId, ownerId, { db: mockDb });
    expect(res1).toEqual({ ok: true, alreadyFrozen: false });

    const res2 = await freezeProject(projectId, ownerId, { db: mockDb });
    expect(res2).toEqual({ ok: true, alreadyFrozen: true });
  });

  it('rejects a freeze on a build/done project as irreversible', async () => {
    const projectId = 'proj-8';
    const ownerId = 'owner-8';

    const mockDb = createMockDb({
      'select:project_audit_pass': [{ id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'clean', findingsCount: 0 }],
      'select:audit_override': [],
      'select:project': [{ id: projectId, phase: 'build' }],
    });

    const res = await freezeProject(projectId, ownerId, { db: mockDb });
    expect(res).toEqual({ ok: true, alreadyFrozen: true });
    void FreezeIrreversibleError;
  });
});
