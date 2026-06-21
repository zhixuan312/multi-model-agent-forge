// @vitest-environment node
import { eq } from 'drizzle-orm';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { proposeFanOut } from '@/exploration/fan-out';
import { mockAnthropic } from './mock-anthropic';
import { createMockDb, seq } from '../test-utils/mock-db';

describe('proposeFanOut', () => {
  it('proposes N investigate + M research + K journal draft rows', async () => {
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const repoId = 'repo-1';

    const mockDb = createMockDb({
      'select:project_artifact': [{ id: 'art-1', projectId, kind: 'exploration_brief', bodyMd: 'We want to add caching to the API.', version: 1 }],
      'select:project_repo': [{ projectId, repoId }],
      'insert:project_exploration_task': [
        { id: 'task-1', projectId, kind: 'investigate', targetRepoId: repoId, prompt: 'how does the API cache today?', status: 'draft', createdBy: ownerId },
        { id: 'task-2', projectId, kind: 'research', targetRepoId: null, prompt: 'what caching strategies fit our stack?', status: 'draft', createdBy: ownerId },
        { id: 'task-3', projectId, kind: 'journal', targetRepoId: null, prompt: 'what did we decide about caching before?', status: 'draft', createdBy: ownerId },
      ],
    });

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      db: mockDb,
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [
            {
              tasks: [
                { kind: 'investigate', targetRepoId: repoId, prompt: 'how does the API cache today?' },
                { kind: 'research', targetRepoId: null, prompt: 'what caching strategies fit our stack?' },
                { kind: 'journal', targetRepoId: null, prompt: 'what did we decide about caching before?' },
              ],
            },
          ],
        },
      }),
    });

    expect(res.failed).toBe(false);
    expect(res.inserted).toHaveLength(3);
  });

  it('drops an invalid kind and an out-of-subset repo (F27) — never inserts malformed rows', async () => {
    const projectId = 'proj-2';
    const ownerId = 'owner-2';
    const repoId = 'repo-2';

    const mockDb = createMockDb({
      'select:project_artifact': [{ id: 'art-1', projectId, kind: 'exploration_brief', bodyMd: 'caching', version: 1 }],
      'select:project_repo': [{ id: repoId }],
      'insert:project_exploration_task': [
        { id: 'task-1', projectId, kind: 'investigate', targetRepoId: repoId, prompt: 'a valid investigate prompt for the selected repo', status: 'draft', createdBy: ownerId },
      ],
    });

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      db: mockDb,
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [
            {
              tasks: [
                { kind: 'investigate', targetRepoId: repoId, prompt: 'a valid investigate prompt for the selected repo' },
                { kind: 'bogus', targetRepoId: null, prompt: 'invalid kind here' },
                { kind: 'investigate', targetRepoId: 'not-in-subset', prompt: 'wrong repo' },
                { kind: 'research', targetRepoId: repoId, prompt: 'research with a repo is invalid here' },
              ],
            },
          ],
        },
      }),
    });

    expect(res.inserted).toHaveLength(1);
    expect(res.inserted[0]).toMatchObject({ kind: 'investigate', targetRepoId: repoId });
  });

  it('re-asks ONCE for a sub-floor prompt, keeps it if repaired', async () => {
    const projectId = 'proj-3';
    const ownerId = 'owner-3';

    const mockDb = createMockDb({
      'select:project_artifact': [{ id: 'art-1', projectId, kind: 'exploration_brief', bodyMd: 'x', version: 1 }],
      'select:project_repo': [],
      'insert:project_exploration_task': [
        { id: 'task-1', projectId, kind: 'research', targetRepoId: null, prompt: 'what external approaches address this problem well?', status: 'draft', createdBy: ownerId },
      ],
    });

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      db: mockDb,
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [{ tasks: [{ kind: 'research', targetRepoId: null, prompt: 'short' }] }],
          'proposeFanOut.repair': [{ prompt: 'what external approaches address this problem well?' }],
        },
      }),
    });
    expect(res.inserted).toHaveLength(1);
    expect(res.inserted[0].prompt).toMatch(/external approaches/);
  });

  it('drops a task whose re-ask STILL returns a sub-floor prompt (bounded — one re-ask)', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';

    const mockDb = createMockDb({
      'select:project_artifact': [{ id: 'art-1', projectId, kind: 'exploration_brief', bodyMd: 'x', version: 1 }],
      'select:project_repo': [],
      'insert:project_exploration_task': [],
    });

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      db: mockDb,
      anthropic: mockAnthropic({
        byCall: {
          proposeFanOut: [{ tasks: [{ kind: 'research', targetRepoId: null, prompt: 'short' }] }],
          'proposeFanOut.repair': [{ prompt: 'still short' }],
        },
      }),
    });
    expect(res.inserted).toHaveLength(0);
  });

  it('a failed/unparseable orchestrator response inserts ZERO rows (F31)', async () => {
    const projectId = 'proj-5';
    const ownerId = 'owner-5';

    const mockDb = createMockDb({
      'select:project_artifact': [{ id: 'art-1', projectId, kind: 'exploration_brief', bodyMd: 'x', version: 1 }],
    });

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      db: mockDb,
      anthropic: mockAnthropic({ byCall: {}, throwOn: new Set(['proposeFanOut']) }),
    });
    expect(res.failed).toBe(true);
    expect(res.inserted).toHaveLength(0);
  });

  it('an empty fan-out (zero tasks) inserts nothing and is not a failure', async () => {
    const projectId = 'proj-6';
    const ownerId = 'owner-6';

    const mockDb = createMockDb({
      'select:project_artifact': [{ id: 'art-1', projectId, kind: 'exploration_brief', bodyMd: 'x', version: 1 }],
      'select:project_repo': [],
      'insert:project_exploration_task': [],
    });

    const res = await proposeFanOut(projectId, { id: ownerId }, {
      db: mockDb,
      anthropic: mockAnthropic({ byCall: { proposeFanOut: [{ tasks: [] }] } }),
    });
    expect(res.failed).toBe(false);
    expect(res.inserted).toHaveLength(0);
  });
});
