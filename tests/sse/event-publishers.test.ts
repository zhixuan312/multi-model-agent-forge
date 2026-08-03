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
