// @vitest-environment node
import { canFreeze } from '@/spec/freeze';
import { createMockDb } from '../test-utils/mock-db';

describe('canFreeze (latest audit verdict gate)', () => {
  it('false when no audit has run', async () => {
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
    });
    expect(await canFreeze(mockDb, 'proj-1')).toBe(false);
  });

  it('true when the latest pass is clean', async () => {
    const mockDb = createMockDb({
      'select:project_audit_pass': [
        { id: 'pass-2', projectId: 'proj-2', scope: 'spec', passNo: 2, verdict: 'clean', findingsCount: 0 },
      ],
    });
    expect(await canFreeze(mockDb, 'proj-2')).toBe(true);
  });

  it('false when the latest pass is revised', async () => {
    const mockDb = createMockDb({
      'select:project_audit_pass': [
        { id: 'pass-1', projectId: 'proj-3', scope: 'spec', passNo: 1, verdict: 'revised', findingsCount: 1 },
      ],
    });
    expect(await canFreeze(mockDb, 'proj-3')).toBe(false);
  });
});
