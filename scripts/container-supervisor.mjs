/**
 * Container supervisor (PID-1 child under tini). Runs the all-in-one deployment:
 * the pinned MMA engine as a loopback co-process, then Forge, tying their
 * lifecycles together.
 *
 * There is exactly one topology. Everyone who runs this image runs Forge, so the
 * image always carries and starts its own matched MMA (`matchedMmaVersion`) on
 * 127.0.0.1:7337 and points Forge at it. MMA enforces loopback-only access, so a
 * single container — one network namespace — is precisely its intended shape.
 * Engineers who want MMA on its own install it themselves; this image is Forge.
 *
 * Boot order: write ~/.mma/config.json from the per-tier env → start `mma serve`
 * → health-gate it → run Forge's idempotent DB bootstrap → start Forge (whose
 * client defaults to that same loopback MMA).
 *
 * Process model: this supervisor spawns MMA + Forge as children. If EITHER exits,
 * the whole container comes down (kill the sibling, exit non-zero on a crash) so an
 * orchestrator restarts a known-good whole, never a half-alive stack. tini is PID 1
 * and reaps zombies + forwards signals to this process.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolveOrWriteConfig, createForgeSchema } from './container-bootstrap.mjs';

const MMA_PORT = 7337;
const MMA_HEALTH_URL = `http://127.0.0.1:${MMA_PORT}/health`;
const MMA_HEALTH_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_MS = 5_000;

function log(msg) {
  process.stdout.write(`[forge-supervisor] ${msg}\n`);
}

/** name -> ChildProcess for the long-running children (mma, forge). */
const children = new Map();
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, child] of children) {
    log(`stopping ${name}`);
    child.kill('SIGTERM');
  }
  // Exit once every child is down, or force it after the grace window.
  const forced = setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS);
  forced.unref();
  const poll = setInterval(() => {
    if (children.size === 0) {
      clearInterval(poll);
      process.exit(code);
    }
  }, 200);
  poll.unref();
}

/** Spawn a long-running child; its death brings the container down. */
function spawnService(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  children.set(name, child);
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    log(`${name} exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'null'}) — bringing the container down`);
    // An unexpected exit is ALWAYS a failure — force non-zero even if the child
    // happened to exit 0, so restart:on-failure and orchestrators react correctly.
    shutdown(typeof code === 'number' && code !== 0 ? code : 1);
  });
  child.on('error', (err) => {
    log(`${name} failed to start: ${err.message}`);
    shutdown(1);
  });
  return child;
}

/** Run a one-shot step to completion; reject on non-zero exit. */
function runStep(name, cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} failed with exit code ${code ?? 'unknown'}`))));
    child.on('error', reject);
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // engine not up yet
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  // PROVIDER is the default protocol for tiers with no PROVIDER_<TIER> override.
  const provider = process.env.PROVIDER?.trim() || 'anthropic';

  log('starting the pinned MMA engine on 127.0.0.1:7337');
  // Generate ~/.mma/config.json from the per-tier env (unless a config is mounted).
  // `mma serve` reads this same file; keyless tiers fall back to the provider's
  // native OAuth (~/.claude / ~/.codex — mount them to use OAuth instead of keys).
  const cfg = await resolveOrWriteConfig({ provider, env: process.env });
  log(`mma config: ${cfg.kind} at ${cfg.path}`);
  spawnService('mma', 'mma', ['serve']);
  const healthy = await waitForHealth(MMA_HEALTH_URL, MMA_HEALTH_TIMEOUT_MS);
  if (!healthy) {
    log(`MMA did not pass ${MMA_HEALTH_URL} within ${MMA_HEALTH_TIMEOUT_MS}ms`);
    shutdown(1);
    return;
  }
  log('MMA is healthy');

  // Forge database bootstrap — idempotent on every start.
  await createForgeSchema(databaseUrl);
  await runStep('db:migrate', 'pnpm', ['db:migrate']);
  await runStep('db:seed-templates', 'pnpm', ['db:seed-templates']);

  log('starting Forge (next standalone server)');
  spawnService('forge', 'node', ['server.js']);
}

process.on('SIGTERM', () => { log('received SIGTERM'); shutdown(0); });
process.on('SIGINT', () => { log('received SIGINT'); shutdown(0); });

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  shutdown(1);
});
