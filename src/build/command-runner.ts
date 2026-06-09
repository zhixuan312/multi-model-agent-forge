import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';

/**
 * The build/test subprocess boundary (Spec 7 §Build/test execution boundary;
 * F9/F13). Runs an inferred command pinned to the repo cwd, under a restricted
 * env (no Forge secrets), with a wall-clock timeout (process-group kill) and a
 * bounded streamed output capture. Classification is by EXIT CODE, not the output
 * cap — a verbose-but-green build passes.
 *
 * The runner is an injectable interface so the executor's tests use a fake and
 * NEVER spawn a real subprocess.
 */

export const BUILD_TEST_TIMEOUT_MS = 600_000; // 10 min, matching MMA's bounded-execution ceiling
export const BUILD_TEST_MAX_OUTPUT_BYTES = 4 * 1024 * 1024; // 4 MiB

/** The secrets that must NEVER reach a build/test subprocess (F9). */
export const SECRET_ENV_KEYS = ['FORGE_SECRET_KEY', 'MMA_AUTH_TOKEN', 'FORGE_GIT_TOKEN', 'GIT_TOKEN'] as const;

export type CommandOutcome =
  | { kind: 'pass' } // exit 0
  | { kind: 'fail'; exitCode: number; outputTail: string } // non-zero exit
  | { kind: 'timeout' } // exceeded wall clock
  | { kind: 'env_error'; detail: string }; // command not found / runtime missing

export interface CommandRunner {
  run(argv: string[], opts: { cwd: string }): Promise<CommandOutcome>;
}

/** Build a minimal child env that OMITS every Forge secret (F9). */
export function safeChildEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const banned = new Set<string>(SECRET_ENV_KEYS);
  for (const [k, v] of Object.entries(base)) {
    if (banned.has(k)) continue;
    if (k.startsWith('FORGE_') || k.startsWith('MMA_') || k === 'DATABASE_URL' || k === 'ANTHROPIC_API_KEY') continue;
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Default runner — `spawn` (args array, NO shell), cwd-pinned, restricted env,
 * bounded output, process-group kill on timeout. ENOENT (command not found) →
 * `env_error` (distinct from a code failure).
 */
export const nodeCommandRunner: CommandRunner = {
  run: (argv, opts) =>
    new Promise<CommandOutcome>((resolve) => {
      const [cmd, ...rest] = argv;
      const spawnOpts: SpawnOptionsWithoutStdio = {
        cwd: opts.cwd,
        env: safeChildEnv() as NodeJS.ProcessEnv,
        shell: false,
        detached: true, // own process group → group-kill on timeout
      };
      const child = spawn(cmd, rest, spawnOpts);
      let bytes = 0;
      let tail = '';
      let settled = false;
      const accumulate = (chunk: Buffer): void => {
        bytes += chunk.length;
        if (bytes <= BUILD_TEST_MAX_OUTPUT_BYTES) tail += chunk.toString();
        else tail = (tail + chunk.toString()).slice(-65536); // keep last 64 KiB
      };
      child.stdout?.on('data', accumulate);
      child.stderr?.on('data', accumulate);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        resolve({ kind: 'timeout' });
      }, BUILD_TEST_TIMEOUT_MS);

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          resolve({ kind: 'env_error', detail: `command not found: ${cmd}` });
        } else {
          resolve({ kind: 'env_error', detail: err.message });
        }
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve({ kind: 'pass' });
        else resolve({ kind: 'fail', exitCode: code ?? 1, outputTail: tail.slice(-4096) });
      });
    }),
};
