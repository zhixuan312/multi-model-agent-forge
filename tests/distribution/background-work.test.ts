// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every background process the product needs must be started by something that actually
 * runs in a deployment.
 *
 * This exists because the Loops scheduler was not. `startLoopWorker` was reachable only
 * through `pnpm loop-worker`, and nothing started that — not the Dockerfile, not
 * `container-supervisor.mjs`, which spawns exactly the MMA engine and the Forge server.
 * `event` loops still fired (they arrive over HTTP), so the gap showed up only as
 * `recurring` loops that sat enabled, with a valid cron expression, and never ran. No
 * error, no log line, nothing to notice.
 *
 * A unit test could not catch that: every piece worked. What was missing was the wiring.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('background work is actually started somewhere', () => {
  it('the Loops scheduler ticks in the server process', () => {
    const instrumentation = read('instrumentation.ts');
    expect(instrumentation).toContain('startLoopWorker');
    expect(instrumentation).toContain('@/loops/scheduler');
  });

  it('the scheduler can be turned off for operators running the standalone worker', () => {
    // Both ticking would let one loop fire twice.
    expect(read('instrumentation.ts')).toContain('FORGE_DISABLE_LOOP_SCHEDULER');
    expect(read('.env.example')).toContain('FORGE_DISABLE_LOOP_SCHEDULER=');
  });

  it('the standalone worker entrypoint still exists for that opt-out to be usable', () => {
    expect(read('package.json')).toContain('"loop-worker"');
    expect(read('src/loops/worker-main.ts')).toContain('startLoopWorker');
  });

  it('the container supervisor starts the engine and the server', () => {
    // Pinned so a change to the process model has to come past this test.
    const sup = read('scripts/container-supervisor.mjs');
    expect(sup).toContain("spawnService('mma'");
    expect(sup).toContain("spawnService('forge'");
  });
});
