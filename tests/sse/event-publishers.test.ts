// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every declared project event must have a PUBLISHER.
 *
 * The union once carried twelve that nothing emitted — the build-monitor design's
 * plan.failed / audit.pass / task.executing / task.verifying / task.fixing / task.fixed /
 * task.committed / build.task_failed / review.done / execute.notice / cost.tick, plus
 * chat.typing, which SpecStageClient had a whole listener for: it toggled a per-component
 * "Forge is typing" state and switched the craft view, and neither could ever fire.
 *
 * A consumer is NOT required — any component can subscribe through `useMmaDispatch`'s
 * `events` map, so a published-but-unsubscribed event is an available signal. A
 * publisher-less one is a promise the server cannot keep.
 */
const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

describe('every declared SSE event can actually be emitted', () => {
  const bus = readFileSync(join(ROOT, 'src/sse/event-bus.ts'), 'utf8');
  const declared = [...new Set([...bus.matchAll(/type: '([a-z_.]+)'/g)].map((m) => m[1]))];
  const elsewhere = [...sources('src'), ...sources('app')]
    .filter((f) => f !== 'src/sse/event-bus.ts')
    .map((f) => readFileSync(join(ROOT, f), 'utf8'))
    .join('\n');

  it('found the union and a real source set', () => {
    expect(declared.length).toBeGreaterThan(10);
    expect(elsewhere.length).toBeGreaterThan(10_000);
  });

  it('has a publisher for each', () => {
    const orphans = declared.filter((t) => !elsewhere.includes(`type: '${t}'`));
    expect(orphans, 'declared but nothing publishes them — remove, or wire the publisher').toEqual([]);
  });
});

/**
 * An event in the union with no publisher, or a publisher with no subscriber, is a signal
 * that does not exist. This file's own history is the argument: eleven were declared and
 * never published, and `plan.authored` was published and never subscribed to — which is how
 * `plan-author` ended up as the only plan handler NOT emitting the signal the Plan rail
 * listens for, leaving an auto-authored plan stale on screen.
 *
 * `dispatch.progress` is the one deliberate exception and it is named here rather than
 * quietly skipped: it carries the "cancelling…" acknowledgement for handler-backed batches,
 * the task-backed twin of which the exploration rail does render. Nothing renders this one —
 * pressing Stop closes the overlay while the engine keeps working. Wiring it needs a
 * decision about where that state belongs, so it stays until someone makes it.
 */
describe('every declared event is published and consumed', () => {
  const UNCONSUMED_BY_DESIGN = new Set(['dispatch.progress', 'heartbeat']);

  const read = (p: string) => readFileSync(p, 'utf8');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.next')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
    }
    return out;
  };

  const BUS = 'src/sse/event-bus.ts';
  const files = [...walk('src'), ...walk('app')].filter((f) => f !== BUS);
  const declared = [...new Set([...read(BUS).matchAll(/type: '([a-z._]+)'/g)].map((m) => m[1]!))];

  it('found the union and the source tree', () => {
    expect(declared.length).toBeGreaterThan(15);
    expect(declared).toContain('plan.stage_updated');
    expect(files.length).toBeGreaterThan(200);
  });

  it('has a publisher for every declared event', () => {
    const orphans = declared.filter((t) => !files.some((f) => read(f).includes(`type: '${t}'`)));
    expect(orphans, 'declared in the union, published by nobody').toEqual([]);
  });

  it('has a consumer for every published event', () => {
    const unread = declared.filter((t) => {
      if (UNCONSUMED_BY_DESIGN.has(t)) return false;
      const publishers = files.filter((f) => read(f).includes(`type: '${t}'`));
      return !files.some((f) => !publishers.includes(f) && read(f).includes(`'${t}'`));
    });
    expect(unread, 'published into the void — wire it or delete it').toEqual([]);
  });
});
