import { QueryClient } from '@tanstack/react-query';
import {
  applyProjectEvent,
  reconcileOnReconnect,
  explorationKeys,
  type RailTask,
} from '@/hooks/useProjectEvents';

function seedTasks(qc: QueryClient, projectId: string, tasks: RailTask[]): void {
  qc.setQueryData(explorationKeys.tasks(projectId), tasks);
}

const baseTask = (id: string): RailTask => ({
  id,
  kind: 'investigate',
  status: 'running',
  prompt: 'x',
  targetRepoId: null,
  mmaBatchId: 'b',
  batchStatus: 'dispatched',
  headline: null,
  error: null,
  outputMd: null,
});

describe('useProjectEvents cache patching (F8)', () => {
  it('task.progress patches the matching task with headline + running status', () => {
    const qc = new QueryClient();
    seedTasks(qc, 'p1', [baseTask('t1'), baseTask('t2')]);
    applyProjectEvent(qc, 'p1', {
      type: 'task.progress',
      taskId: 't1',
      mmaBatchId: 'b',
      headline: 'reading…',
      route: 'investigate',
      status: 'running',
    });
    const tasks = qc.getQueryData<RailTask[]>(explorationKeys.tasks('p1'))!;
    expect(tasks.find((t) => t.id === 't1')).toMatchObject({ headline: 'reading…', batchStatus: 'running' });
    expect(tasks.find((t) => t.id === 't2')!.headline).toBeNull();
  });

  it('task.done flips the task to recorded/done', () => {
    const qc = new QueryClient();
    seedTasks(qc, 'p1', [baseTask('t1')]);
    applyProjectEvent(qc, 'p1', { type: 'task.done', taskId: 't1', mmaBatchId: 'b', route: 'investigate', status: 'recorded' });
    expect(qc.getQueryData<RailTask[]>(explorationKeys.tasks('p1'))![0]).toMatchObject({
      status: 'recorded',
      batchStatus: 'done',
    });
  });

  it('task.failed records the error and failed batch status', () => {
    const qc = new QueryClient();
    seedTasks(qc, 'p1', [baseTask('t1')]);
    applyProjectEvent(qc, 'p1', {
      type: 'task.failed',
      taskId: 't1',
      mmaBatchId: 'b',
      route: 'investigate',
      error: { code: 'x', message: 'boom' },
    });
    expect(qc.getQueryData<RailTask[]>(explorationKeys.tasks('p1'))![0]).toMatchObject({
      batchStatus: 'failed',
      error: { code: 'x', message: 'boom' },
    });
  });

  it('synthesis.updated patches the artifact cache entry version', () => {
    const qc = new QueryClient();
    qc.setQueryData(explorationKeys.artifact('p1'), { id: 'a0', version: 1, bodyMd: 'old' });
    applyProjectEvent(qc, 'p1', { type: 'synthesis.updated', artifactId: 'a1', version: 2 });
    expect(qc.getQueryData(explorationKeys.artifact('p1'))).toMatchObject({ id: 'a1', version: 2 });
  });

  it('reconnect invalidates the task-list query (reconcile missed transitions)', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    reconcileOnReconnect(qc, 'p1');
    expect(spy).toHaveBeenCalledWith({ queryKey: explorationKeys.tasks('p1') });
  });

  it('heartbeat is a no-op', () => {
    const qc = new QueryClient();
    seedTasks(qc, 'p1', [baseTask('t1')]);
    const before = qc.getQueryData(explorationKeys.tasks('p1'));
    applyProjectEvent(qc, 'p1', { type: 'heartbeat', t: 1 });
    expect(qc.getQueryData(explorationKeys.tasks('p1'))).toBe(before);
  });
});
