// @vitest-environment node
import { canFreeze } from '@/spec/freeze';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

describe('canFreeze (latest audit verdict gate)', () => {
  it('false when no audit has run', async () => {
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
    });
    expect(await canFreeze(mockDb, 'proj-1')).toBe(false);
  });

  it('true when the latest pass is clean', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'clean', audit: { attempts: [{ batchId: 'a1', status: 'done', at: '' }] } },
    ];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
    });
    expect(await canFreeze(mockDb, 'proj-2')).toBe(true);
  });

  it('false when the latest pass is revised', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'revised', audit: { attempts: [{ batchId: 'a1', status: 'done', at: '' }] } },
    ];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
    });
    expect(await canFreeze(mockDb, 'proj-3')).toBe(false);
  });
});
