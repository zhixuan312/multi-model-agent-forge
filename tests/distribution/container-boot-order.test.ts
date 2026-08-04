// @vitest-environment node
/**
 * The container's real boot order — the one `docker/entrypoint.sh` runs.
 *
 * This replaces a test called "runs config ensure, schema create, migrate, seed, then starts
 * the standalone server", which exercised an `ensureBootOrder` export that NOTHING called.
 * The live path is `container-supervisor.mjs`, and its order is different in ways that
 * matter: it starts the MMA engine first and refuses to continue until `/health` answers.
 * So the sequence with a test was the dead one, and the sequence that ships had none.
 *
 * Read from source rather than executed: `main()` spawns real processes (`mma serve`,
 * `pnpm db:migrate`, `node server.js`) and awaits a health endpoint. Injecting all of that
 * is what produced the fake-but-tested `ensureBootOrder` in the first place. Ordering is
 * the property at risk here, and source order is exactly what encodes it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'scripts/container-supervisor.mjs'), 'utf8');
const MAIN = SRC.slice(SRC.indexOf('async function main()'));

/** Each step's position inside `main()`, in the order the container must perform them. */
const STEPS: ReadonlyArray<[string, string]> = [
  ['config', 'resolveOrWriteConfig('],
  ['skill manifest reconcile', 'reconcileSkillManifest('],
  ['start MMA', "spawnService('mma'"],
  ['health gate', 'waitForHealth('],
  ['create schema', 'createForgeSchema('],
  ['migrate', "runStep('db:migrate'"],
  ['seed templates', "runStep('db:seed-templates'"],
  ['start Forge', "spawnService('forge'"],
];

describe('container boot order', () => {
  it('main() performs every step', () => {
    const missing = STEPS.filter(([, needle]) => !MAIN.includes(needle)).map(([name]) => name);
    expect(missing, 'a boot step vanished from container-supervisor.mjs').toEqual([]);
  });

  it('performs them in the required order', () => {
    const positions = STEPS.map(([name, needle]) => ({ name, at: MAIN.indexOf(needle) }));
    const sorted = [...positions].sort((a, b) => a.at - b.at).map((p) => p.name);
    expect(sorted, 'the boot steps are out of order').toEqual(STEPS.map(([n]) => n));
  });

  /**
   * The two orderings that are not merely conventional:
   *  - the config is written BEFORE `mma serve` starts, because that is the file it reads;
   *  - Forge starts only after the health gate, or its first dispatch hits a dead engine.
   */
  it('writes the MMA config before starting the engine that reads it', () => {
    expect(MAIN.indexOf('resolveOrWriteConfig(')).toBeLessThan(MAIN.indexOf("spawnService('mma'"));
  });

  it('gates Forge behind MMA health, and bails instead of starting it half-alive', () => {
    expect(MAIN.indexOf('waitForHealth(')).toBeLessThan(MAIN.indexOf("spawnService('forge'"));
    // The unhealthy branch must STOP — an early `return` after `shutdown(1)`. Falling
    // through would boot Forge against an engine that never answered.
    const unhealthy = MAIN.slice(MAIN.indexOf('if (!healthy)'), MAIN.indexOf('MMA is healthy'));
    expect(unhealthy).toContain('shutdown(1)');
    expect(unhealthy).toContain('return;');
  });

  /** The entrypoint must actually exec the supervisor — the whole order hangs off that. */
  it('is the process the entrypoint execs', () => {
    const entry = readFileSync(join(process.cwd(), 'docker/entrypoint.sh'), 'utf8');
    expect(entry).toContain('container-supervisor.mjs');
  });

  /**
   * The dead parallel sequence must not come back. Matched on the EXPORT, not the word:
   * the first version of this asserted the module never mentions `ensureBootOrder` and
   * failed against the docstring explaining why it was removed — a check that forbids
   * writing down its own reason.
   */
  it('container-bootstrap.mjs exports helpers only, never a rival boot sequence', () => {
    const boot = readFileSync(join(process.cwd(), 'scripts/container-bootstrap.mjs'), 'utf8');
    const exported = [...boot.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(['buildGeneratedConfig', 'createForgeSchema', 'resolveOrWriteConfig']);
    expect(boot, 'spawning from the helper module means a second boot path').not.toContain("from 'node:child_process'");
  });
});
