/**
 * MMA config-supervisor (Spec 2 §config-supervisor / `lib/mma/config-supervisor.ts`).
 *
 * The riskiest component in the product: it owns `~/.multi-model/config.json`
 * and (re)starts the co-located MMA process. This module is split into a PURE
 * half (`buildMmaConfig`, `envVarName`) that is fully unit-testable without any
 * process, and an EFFECTFUL half (`MmaSupervisor.applyConfig`) that writes the
 * config atomically and drives a restart through an INJECTED `ProcessController`.
 *
 * ── SAFETY (the hard constraints) ───────────────────────────────────────────
 *   • The config file path comes ONLY from `configPath` (callers default it to
 *     `MMA_CONFIG_PATH` → `~/.multi-model/config.json`). Tests point it at a temp
 *     file, so no test path mutates the real config.
 *   • The restart goes ONLY through the injected `ProcessController`. The DEV
 *     default is `NoopProcessController` (logs only) so applying config in dev
 *     never signals the real daemon. A real `child_process` controller lands with
 *     the deployed Forge server (out of this slice's test surface).
 *   • Secrets (decrypted provider keys + the MMA bearer) NEVER appear in any log
 *     event or error text, and keys flow to the process via `env` only.
 */
import { mkdirSync, renameSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Row shapes (a subset of the Forge DB rows the supervisor consumes) ───────

export type ProviderType = 'claude' | 'codex';

export interface ProviderRow {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  apiKeyRef: string | null;
}

export interface TierRow {
  tier: 'main' | 'complex' | 'standard';
  providerId: string | null;
  model: string | null;
}

// ── PURE: env-var name derivation ────────────────────────────────────────────

/**
 * Deterministic env-var name for a provider's API key, derived from `provider.id`
 * (a uuid — unique + ASCII). Non-`[A-Z0-9]` chars → `_`, uppercased, wrapped as
 * `MMA_PROVIDER_<ID>_API_KEY`. The SAME helper feeds both the `apiKeyEnv` written
 * into config.json AND the env-var key set on the spawned process — so they can
 * never drift.
 */
export function envVarName(provider: ProviderRow): string {
  const sanitized = provider.id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return `MMA_PROVIDER_${sanitized}_API_KEY`;
}

// ── PURE: buildMmaConfig ─────────────────────────────────────────────────────

/** A single agent entry as written into MMA's `agents.{complex,standard}`. */
export interface BuiltAgent {
  type: ProviderType;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

/** The Forge-owned slice of MMA's config (agents block + preserved operator blocks). */
export interface BuiltConfig {
  agents: { standard: BuiltAgent; complex: BuiltAgent };
  [k: string]: unknown; // verbatim operator-preserved blocks (defaults/server/research/…)
}

export interface BuildOptions {
  /** ref → decrypted plaintext for any NON-NULL api_key_ref. */
  secretsByRef?: Record<string, string>;
  /** Existing on-disk config object to read-merge (operator blocks preserved). */
  existing?: Record<string, unknown> | null;
}

export interface BuildResult {
  config: BuiltConfig;
  /** env-var name → decrypted key, to be injected on the spawned MMA process. */
  env: Record<string, string>;
  warnings: string[];
}

function buildAgent(
  tier: TierRow,
  providersById: Map<string, ProviderRow>,
  secretsByRef: Record<string, string>,
  env: Record<string, string>,
): BuiltAgent {
  if (!tier.providerId || !tier.model || tier.model.trim() === '') {
    throw new Error(`The ${tier.tier} tier must have a provider and a non-empty model before applying.`);
  }
  const provider = providersById.get(tier.providerId);
  if (!provider) {
    throw new Error(`The ${tier.tier} tier references a provider that does not exist.`);
  }
  const agent: BuiltAgent = { type: provider.type, model: tier.model };
  if (provider.baseUrl) agent.baseUrl = provider.baseUrl;

  // api_key_ref handling (F14): NULL = provider-default (skip decryption, omit
  // apiKeyEnv). Non-NULL must resolve, else ABORT naming the provider.
  if (provider.apiKeyRef !== null) {
    const key = secretsByRef[provider.apiKeyRef];
    if (key === undefined) {
      throw new Error(
        `The API key for provider "${provider.name}" could not be resolved — the stored secret is missing or undecryptable (FORGE_SECRET_KEY may be unavailable or changed).`,
      );
    }
    const name = envVarName(provider);
    agent.apiKeyEnv = name;
    env[name] = key; // inject on the spawned process; never inline in the file
  }
  return agent;
}

/**
 * Build the MMA config from `provider`/`agent_tier` rows. Maps complex+standard
 * → `agents.{complex,standard}`; `main` is NEVER written (it is only the
 * X-MMA-Main-Model header). Read-merges an `existing` object: replaces ONLY the
 * `agents` block, preserving every operator block (defaults/server/research/…)
 * verbatim. Throws (abort) on an incomplete roster or an unresolvable key.
 */
export function buildMmaConfig(
  providers: ProviderRow[],
  tiers: TierRow[],
  opts: BuildOptions,
): BuildResult {
  const providersById = new Map(providers.map((p) => [p.id, p]));
  const secretsByRef = opts.secretsByRef ?? {};
  const env: Record<string, string> = {};
  const warnings: string[] = [];

  const byTier = new Map(tiers.map((t) => [t.tier, t]));
  const complex = byTier.get('complex');
  const standard = byTier.get('standard');
  if (!complex || !standard) {
    throw new Error('Both the complex and standard tiers must be configured before applying.');
  }

  const agents = {
    complex: buildAgent(complex, providersById, secretsByRef, env),
    standard: buildAgent(standard, providersById, secretsByRef, env),
  };

  const main = byTier.get('main');
  if (!main || !main.model || main.model.trim() === '') {
    warnings.push('Set a Main tier model before running any project work (X-MMA-Main-Model will be unset).');
  }

  // Read-merge: start from the existing object (verbatim operator blocks),
  // replace only `agents`. No existing → minimal { agents } object (MMA fills
  // server/research/defaults from its own Zod schema defaults at load time).
  const merged: BuiltConfig = opts.existing
    ? ({ ...(opts.existing as Record<string, unknown>), agents } as BuiltConfig)
    : ({ agents } as BuiltConfig);

  return { config: merged, env, warnings };
}

// ── ProcessController seam ────────────────────────────────────────────────────

/**
 * The injected supervision seam. `MmaSupervisor` calls these and never touches a
 * real process itself, so dev/test can inject a no-op or a fake.
 */
export interface ProcessController {
  /** True when MMA is a local process this controller may spawn/signal. */
  isLocal(): boolean;
  /**
   * Drain in-flight work, stop, and (re)spawn MMA with `env` (the decrypted
   * keys). Throws an `ErrnoException` with `code ∈ {ENOENT,EACCES,EPERM}` on a
   * spawn failure (binary unresolvable / not permitted).
   */
  gracefulRestart(env: Record<string, string>): Promise<void>;
  /** Poll /health until live (ok OR drift) within the health timeout; false on timeout. */
  waitHealthy(): Promise<boolean>;
  /** Pre-apply in-flight batch count (for the "N batches in flight" warning). */
  activeBatches(): Promise<number>;
}

/**
 * DEV-DEFAULT controller: logs intent, touches nothing. Used so that applying
 * config in dev/test writes the (temp) file but never signals the real daemon.
 */
export class NoopProcessController implements ProcessController {
  constructor(private logSink: (e: { event: string; record: Record<string, unknown> }) => void = () => {}) {}
  isLocal(): boolean {
    return true;
  }
  async gracefulRestart(): Promise<void> {
    this.logSink({ event: 'mma.noop.restart', record: { note: 'NoopProcessController: restart skipped (dev)' } });
  }
  async waitHealthy(): Promise<boolean> {
    return true;
  }
  async activeBatches(): Promise<number> {
    return 0;
  }
}

// ── Result shapes ─────────────────────────────────────────────────────────────

export interface ApplyResult {
  ok: boolean;
  restartedAt: string | null;
  error: string | null;
  warnings: string[];
}

type LogEvt = { event: string; record: Record<string, unknown> };

export interface MmaSupervisorOpts {
  /** Absolute config path — defaults via the caller to MMA_CONFIG_PATH. */
  configPath: string;
  controller: ProcessController;
  /** ref → decrypted key for non-NULL provider api_key_refs. */
  secretsByRef?: Record<string, string>;
  /** The MMA bearer, supplied only so the redaction test can assert it never leaks. */
  bearerForRedaction?: string;
  logSink?: (e: LogEvt) => void;
}

export interface ApplyInput {
  providers: ProviderRow[];
  tiers: TierRow[];
}

/**
 * Resolve the default config path: `MMA_CONFIG_PATH` env, else
 * `<MMA_HOME|$HOME>/.multi-model/config.json`. Callers that don't set
 * `configPath` use this — but tests ALWAYS pass an explicit temp path.
 */
export function defaultMmaConfigPath(homeOverride?: string): string {
  const explicit = process.env.MMA_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  const home = homeOverride ?? process.env.MMA_HOME?.trim() ?? process.env.HOME ?? '';
  return join(home, '.multi-model', 'config.json');
}

export class MmaSupervisor {
  private applying = false;

  constructor(private readonly opts: MmaSupervisorOpts) {}

  private log(event: string, record: Record<string, unknown> = {}): void {
    this.opts.logSink?.({ event, record });
  }

  /**
   * Atomic write: temp file in the same dir → rename → mode 0600. No in-place
   * truncate of the live config; the rename is the publish step.
   */
  private writeConfigAtomically(config: BuiltConfig): void {
    const path = this.opts.configPath;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  }

  private readExisting(): Record<string, unknown> | null {
    if (!existsSync(this.opts.configPath)) return null;
    try {
      return JSON.parse(readFileSync(this.opts.configPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // A corrupt existing file is treated as "no existing" — we replace it with
      // a valid object rather than refusing to apply.
      return null;
    }
  }

  /**
   * The Save & apply flow: validate+build (abort on error) → atomic write →
   * restart via the controller (skipped for a remote MMA) → confirm health.
   */
  async applyConfig(input: ApplyInput): Promise<ApplyResult> {
    if (this.applying) {
      return { ok: false, restartedAt: null, error: 'An apply is already in progress.', warnings: [] };
    }
    this.applying = true;
    try {
      return await this.runApply(input);
    } finally {
      this.applying = false;
    }
  }

  private async runApply(input: ApplyInput): Promise<ApplyResult> {
    const warnings: string[] = [];

    // 1. Build (pure). Any validation/secret failure aborts BEFORE any I/O.
    let built: BuildResult;
    try {
      const existing = this.readExisting();
      built = buildMmaConfig(input.providers, input.tiers, {
        secretsByRef: this.opts.secretsByRef ?? {},
        existing,
      });
    } catch (e) {
      const msg = (e as Error).message;
      this.log('mma.apply.aborted', { reason: 'build', message: msg });
      return { ok: false, restartedAt: null, error: msg, warnings };
    }
    warnings.push(...built.warnings);

    const local = this.opts.controller.isLocal();
    this.log('mma.apply.start', {
      configPath: this.opts.configPath,
      mode: local ? 'forge-spawned' : 'remote',
    });

    // 2. Write atomically. An fs failure aborts before any restart.
    try {
      this.writeConfigAtomically(built.config);
      this.log('mma.config.written', { configPath: this.opts.configPath });
    } catch (e) {
      const msg = `Couldn't write ${this.opts.configPath}: ${(e as Error).message}`;
      this.log('mma.config.write_failed', { message: msg });
      return { ok: false, restartedAt: null, error: msg, warnings };
    }

    // 3. Remote MMA: config written, no local restart (we don't own the process).
    if (!local) {
      warnings.push('MMA is remote — config written; restart the remote MMA out-of-band to apply.');
      return { ok: true, restartedAt: null, error: null, warnings };
    }

    // 4. Pre-apply in-flight snapshot (mandatory advisory warning).
    try {
      const active = await this.opts.controller.activeBatches();
      if (active > 0) {
        this.log('mma.drain.start', { activeBatches: active });
        warnings.push(`${active} batch(es) in flight — applying will restart MMA and drain them.`);
      }
    } catch {
      /* snapshot is best-effort */
    }

    // 5. Graceful restart with the decrypted env (keys via env only).
    try {
      await this.opts.controller.gracefulRestart(built.env);
      this.log('mma.spawn', {});
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
        const msg = 'MMA failed to start (binary not found or not permitted) — MMA is now stopped. Restart manually to apply.';
        this.log('mma.spawn.failed', { code });
        return { ok: false, restartedAt: null, error: msg, warnings };
      }
      const msg = `MMA restart failed: ${(e as Error).message}`;
      this.log('mma.spawn.failed', { message: msg });
      return { ok: false, restartedAt: null, error: msg, warnings };
    }

    // 6. Confirm health (ok OR drift counts as live).
    const healthy = await this.opts.controller.waitHealthy();
    if (!healthy) {
      const msg = 'Config saved but MMA failed to come up healthy — check logs.';
      this.log('mma.health.timeout', {});
      return { ok: false, restartedAt: null, error: msg, warnings };
    }
    const restartedAt = new Date().toISOString();
    this.log('mma.health.ok', { restartedAt });
    return { ok: true, restartedAt, error: null, warnings };
  }
}
