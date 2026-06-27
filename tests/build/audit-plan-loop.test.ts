// @vitest-environment node
import { planAuditHistory } from '@/build/audit-plan-loop';
import { createMockDb } from '../test-utils/mock-db';

describe('planAuditHistory', () => {
  it('returns empty for a project with no plan audit passes', async () => {
    const db = createMockDb({ 'select:project_audit_pass': [] });
    const history = await planAuditHistory(db, 'proj-1');
    expect(history).toEqual([]);
  });

  it('returns passes ordered oldest-first', async () => {
    const db = createMockDb({
      'select:project_audit_pass': [
        { passNo: 1, findingsCount: 2, verdict: 'revised', createdAt: new Date('2026-01-01') },
        { passNo: 2, findingsCount: 0, verdict: 'clean', createdAt: new Date('2026-01-02') },
      ],
    });
    const history = await planAuditHistory(db, 'proj-1');
    expect(history.map((h) => h.passNo)).toEqual([1, 2]);
    expect(history.map((h) => h.verdict)).toEqual(['revised', 'clean']);
  });
});
