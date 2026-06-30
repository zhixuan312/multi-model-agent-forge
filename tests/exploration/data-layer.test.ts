// @vitest-environment node
import { createMockDb } from '../test-utils/mock-db';
import { mmaBatch } from '@/db/schema/ops';

describe('Exploration data layer', () => {
  it('ops_mma_batch round-trips one-repo-per-task; research/journal-recall store null repo but NON-NULL cwd', async () => {
    const db = createMockDb({
      'select:ops_mma_batch': [
        { id: 'batch-1', projectId: 'proj-1', route: 'investigate', targetRepoId: 'repo-1', cwd: '/work/a', request: {}, dispatchedBy: 'member-1', createdAt: new Date() },
        { id: 'batch-2', projectId: 'proj-1', route: 'research', targetRepoId: null, cwd: '/work', request: {}, dispatchedBy: null, createdAt: new Date() },
        { id: 'batch-3', projectId: 'proj-1', route: 'journal_recall', targetRepoId: null, cwd: '/work', request: {}, dispatchedBy: null, createdAt: new Date() },
      ],
    });

    const rows = await db.select().from(mmaBatch);

    const investigate = rows.find((r: any) => r.route === 'investigate');
    expect(investigate?.targetRepoId).toBe('repo-1');
    expect(investigate?.cwd).toBe('/work/a');

    const research = rows.find((r: any) => r.route === 'research');
    expect(research?.targetRepoId).toBeNull();
    expect(research?.cwd).toBe('/work');

    const journal = rows.find((r: any) => r.route === 'journal_recall');
    expect(journal?.targetRepoId).toBeNull();
    expect(journal?.cwd).toBe('/work');
  });
});
