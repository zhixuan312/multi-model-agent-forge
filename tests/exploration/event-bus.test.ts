// @vitest-environment node
import { ProjectEventBus, MAX_SUBSCRIBERS_PER_PROJECT, type ProjectEvent } from '@/sse/event-bus';

function progress(taskId: string): ProjectEvent {
  return { type: 'task.progress', taskId, mmaBatchId: 'b', headline: 'hi', route: 'investigate', status: 'running' };
}

describe('ProjectEventBus', () => {
  it('delivers events to a project subscriber', () => {
    const bus = new ProjectEventBus();
    const seen: ProjectEvent[] = [];
    bus.subscribe('p1', (e) => seen.push(e));
    bus.publish('p1', progress('t1'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'task.progress', taskId: 't1' });
  });

  it('keys by projectId — a second project does not leak events', () => {
    const bus = new ProjectEventBus();
    const p1: ProjectEvent[] = [];
    const p2: ProjectEvent[] = [];
    bus.subscribe('p1', (e) => p1.push(e));
    bus.subscribe('p2', (e) => p2.push(e));
    bus.publish('p1', progress('t1'));
    expect(p1).toHaveLength(1);
    expect(p2).toHaveLength(0);
  });

  it('refcount teardown: the channel Map entry is removed when the last subscriber leaves (F9)', () => {
    const bus = new ProjectEventBus();
    const un1 = bus.subscribe('p1', () => {});
    const un2 = bus.subscribe('p1', () => {});
    expect(bus.hasChannel('p1')).toBe(true);
    expect(bus.subscriberCount('p1')).toBe(2);

    un1();
    expect(bus.hasChannel('p1')).toBe(true); // still one subscriber

    un2();
    expect(bus.hasChannel('p1')).toBe(false); // last one gone → Map entry removed
    expect(bus.subscriberCount('p1')).toBe(0);

    // A subsequent subscribe re-creates the channel.
    bus.subscribe('p1', () => {});
    expect(bus.hasChannel('p1')).toBe(true);
  });

  it('unsubscribe is idempotent', () => {
    const bus = new ProjectEventBus();
    const un = bus.subscribe('p1', () => {});
    un();
    un(); // no throw, no double-decrement
    expect(bus.hasChannel('p1')).toBe(false);
  });

  it('raises the per-project listener cap to 100 — no MaxListenersExceededWarning at scale', () => {
    const bus = new ProjectEventBus();
    const warnings: unknown[] = [];
    const onWarn = (w: unknown) => warnings.push(w);
    process.on('warning', onWarn);
    try {
      const uns = Array.from({ length: 50 }, () => bus.subscribe('p1', () => {}));
      expect(bus.subscriberCount('p1')).toBe(50);
      expect(MAX_SUBSCRIBERS_PER_PROJECT).toBe(100);
      uns.forEach((u) => u());
    } finally {
      process.off('warning', onWarn);
    }
    expect(warnings.filter((w) => String(w).includes('MaxListenersExceededWarning'))).toHaveLength(0);
  });
});
