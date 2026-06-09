// @vitest-environment node
import { vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMmaConfig,
  envVarName,
  MmaSupervisor,
  NoopProcessController,
  type ProcessController,
  type ProviderRow,
  type TierRow,
} from '@/mma/supervisor';

const SECRET = 'super-secret-key-VALUE';
const BEARER = 'mma-bearer-TOKEN';

function provider(over: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Claude',
    type: 'claude',
    baseUrl: null,
    apiKeyRef: null,
    ...over,
  };
}

function tiers(over: Partial<Record<'main' | 'complex' | 'standard', Partial<TierRow>>> = {}): TierRow[] {
  const base: Record<'main' | 'complex' | 'standard', TierRow> = {
    main: { tier: 'main', providerId: null, model: 'claude-opus-4-8' },
    complex: { tier: 'complex', providerId: provider().id, model: 'claude-opus-4-8' },
    standard: { tier: 'standard', providerId: provider().id, model: 'claude-haiku-4-5' },
  };
  for (const [k, v] of Object.entries(over)) {
    base[k as 'main' | 'complex' | 'standard'] = { ...base[k as 'main' | 'complex' | 'standard'], ...v };
  }
  return [base.main, base.complex, base.standard];
}

// ── PURE: buildMmaConfig ──────────────────────────────────────────────────────

describe('envVarName', () => {
  it('is deterministic, POSIX-valid, derived from provider.id', () => {
    const name = envVarName(provider({ id: 'ab-CD_12' }));
    expect(name).toBe('MMA_PROVIDER_AB_CD_12_API_KEY');
    expect(name).toMatch(/^[A-Z_][A-Z0-9_]*$/);
  });
  it('never collides for distinct provider ids', () => {
    expect(envVarName(provider({ id: 'a' }))).not.toBe(envVarName(provider({ id: 'b' })));
  });
});

describe('buildMmaConfig', () => {
  it('maps complex+standard → agents.{complex,standard}; excludes main', () => {
    const p = provider();
    const { config } = buildMmaConfig([p], tiers(), {});
    expect(Object.keys(config.agents).sort()).toEqual(['complex', 'standard']);
    expect((config.agents as Record<string, unknown>)).not.toHaveProperty('main');
    expect(config.agents.complex.model).toBe('claude-opus-4-8');
    expect(config.agents.standard.model).toBe('claude-haiku-4-5');
    expect(config.agents.complex.type).toBe('claude');
  });

  it('omits apiKeyEnv for a NULL api_key_ref (provider-default), no env derived', () => {
    const p = provider({ apiKeyRef: null });
    const { config, env } = buildMmaConfig([p], tiers(), { secretsByRef: {} });
    expect('apiKeyEnv' in config.agents.complex).toBe(false);
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('emits apiKeyEnv + spawned env for a resolved non-NULL key (same helper, no drift)', () => {
    const p = provider({ apiKeyRef: 'ref-key' });
    const { config, env } = buildMmaConfig([p], tiers(), { secretsByRef: { 'ref-key': SECRET } });
    const envName = envVarName(p);
    expect(config.agents.complex.apiKeyEnv).toBe(envName);
    expect(config.agents.standard.apiKeyEnv).toBe(envName);
    expect(env[envName]).toBe(SECRET);
    // secret goes via apiKeyEnv, never inline apiKey
    expect('apiKey' in config.agents.complex).toBe(false);
  });

  it('respects per-provider baseUrl when set', () => {
    const p = provider({ baseUrl: 'https://proxy.example' });
    const { config } = buildMmaConfig([p], tiers(), {});
    expect(config.agents.complex.baseUrl).toBe('https://proxy.example');
  });

  it('aborts (throws) when a configured tier has no model', () => {
    expect(() => buildMmaConfig([provider()], tiers({ complex: { model: null } }), {})).toThrow(/complex/i);
  });

  it('aborts when a tier references a provider not in the list', () => {
    expect(() =>
      buildMmaConfig([provider()], tiers({ complex: { providerId: 'ghost' } }), {}),
    ).toThrow(/provider/i);
  });

  it('aborts when a non-NULL key ref is unresolvable, naming the provider', () => {
    const p = provider({ apiKeyRef: 'dangling' });
    expect(() => buildMmaConfig([p], tiers(), { secretsByRef: {} })).toThrow(/Claude/);
  });

  it('read-merges: preserves an operator defaults/server/research block verbatim, replaces only agents', () => {
    const existing = {
      agents: { standard: { type: 'claude', model: 'old' }, complex: { type: 'claude', model: 'old' } },
      defaults: { tools: 'readonly', somethingOperatorAdded: true },
      research: { brave: { apiKeys: ['k1'] } },
      telemetry: { enabled: true },
    };
    const { config } = buildMmaConfig([provider()], tiers(), { existing });
    expect(config.defaults).toEqual(existing.defaults); // verbatim, incl. unknown key
    expect(config.research).toEqual(existing.research);
    expect(config.telemetry).toEqual(existing.telemetry);
    expect(config.agents.complex.model).toBe('claude-opus-4-8'); // replaced
  });

  it('emits a minimal valid object (agents only) when no existing config is present', () => {
    const { config } = buildMmaConfig([provider()], tiers(), { existing: null });
    expect(config.agents.standard.model).toBe('claude-haiku-4-5');
    expect(config).not.toHaveProperty('defaults'); // we do not invent operator blocks
  });
});

// ── EFFECTFUL: MmaSupervisor.applyConfig ──────────────────────────────────────

/** A fake ProcessController that records calls; NEVER touches a real process. */
class FakeController implements ProcessController {
  public calls: string[] = [];
  public spawnedEnv: Record<string, string> | null = null;
  public mode: 'forge-spawned' | 'remote' = 'forge-spawned';
  constructor(
    private opts: { healthy?: boolean; failSpawn?: 'ENOENT' | 'EACCES' | null } = { healthy: true },
  ) {}
  isLocal(): boolean {
    return this.mode !== 'remote';
  }
  async gracefulRestart(env: Record<string, string>): Promise<void> {
    this.calls.push('gracefulRestart');
    this.spawnedEnv = env;
    if (this.opts.failSpawn) {
      const e = new Error('spawn mmagent') as NodeJS.ErrnoException;
      e.code = this.opts.failSpawn;
      throw e;
    }
  }
  async waitHealthy(): Promise<boolean> {
    this.calls.push('waitHealthy');
    return this.opts.healthy ?? true;
  }
  async activeBatches(): Promise<number> {
    return 0;
  }
}

function tmpConfigPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mma-cfg-'));
  return { dir, path: join(dir, 'config.json') };
}

describe('MmaSupervisor.applyConfig', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    const t = tmpConfigPath();
    dir = t.dir;
    path = t.path;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function sup(controller: ProcessController, sink?: (e: unknown) => void): MmaSupervisor {
    return new MmaSupervisor({
      configPath: path,
      controller,
      secretsByRef: { 'ref-key': SECRET },
      logSink: sink,
    });
  }

  it('happy path: writes config (temp+rename, 0600), restarts via controller, health ok', async () => {
    const ctrl = new FakeController({ healthy: true });
    const res = await sup(ctrl).applyConfig({ providers: [provider({ apiKeyRef: 'ref-key' })], tiers: tiers() });
    expect(res.ok).toBe(true);
    expect(res.restartedAt).not.toBeNull();
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(ctrl.calls).toEqual(['gracefulRestart', 'waitHealthy']);
    // env carries the decrypted key under the derived var name
    expect(ctrl.spawnedEnv![envVarName(provider())]).toBe(SECRET);
  });

  it('NEVER writes the real ~/.multi-model/config.json (path comes from configPath)', async () => {
    const ctrl = new FakeController();
    await sup(ctrl).applyConfig({ providers: [provider()], tiers: tiers() });
    // the file we wrote is the temp path, not anything under a real home dir
    expect(path).toContain('mma-cfg-');
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.agents.complex.model).toBe('claude-opus-4-8');
  });

  it('NoopProcessController is the dev default — applyConfig touches no real daemon', async () => {
    const noop = new NoopProcessController();
    const res = await new MmaSupervisor({ configPath: path, controller: noop }).applyConfig({
      providers: [provider()],
      tiers: tiers(),
    });
    expect(res.ok).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('drift counts as healthy (waitHealthy true) → ok', async () => {
    const ctrl = new FakeController({ healthy: true });
    const res = await sup(ctrl).applyConfig({ providers: [provider()], tiers: tiers() });
    expect(res.ok).toBe(true);
  });

  it('health never ok → ApplyResult.error, config file NOT rolled back', async () => {
    const ctrl = new FakeController({ healthy: false });
    const res = await sup(ctrl).applyConfig({ providers: [provider()], tiers: tiers() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/health|come up/i);
    expect(existsSync(path)).toBe(true); // not rolled back
  });

  it('spawn ENOENT → distinct "failed to start" error, no waitHealthy attempted', async () => {
    const ctrl = new FakeController({ failSpawn: 'ENOENT' });
    const res = await sup(ctrl).applyConfig({ providers: [provider()], tiers: tiers() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/failed to start|not found|not permitted/i);
    expect(ctrl.calls).not.toContain('waitHealthy');
  });

  it('invalid roster (no model) → abort before any controller call, no file written', async () => {
    const ctrl = new FakeController();
    const res = await sup(ctrl).applyConfig({
      providers: [provider()],
      tiers: tiers({ complex: { model: null } }),
    });
    expect(res.ok).toBe(false);
    expect(ctrl.calls).toHaveLength(0);
    expect(existsSync(path)).toBe(false);
  });

  it('secret decrypt failure (dangling non-NULL ref) → abort before write/restart', async () => {
    const ctrl = new FakeController();
    const res = await new MmaSupervisor({ configPath: path, controller: ctrl, secretsByRef: {} }).applyConfig({
      providers: [provider({ apiKeyRef: 'dangling' })],
      tiers: tiers(),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Claude/);
    expect(ctrl.calls).toHaveLength(0);
    expect(existsSync(path)).toBe(false);
  });

  it('read-merge preserves a pre-existing operator defaults block on disk', async () => {
    writeFileSync(
      path,
      JSON.stringify({
        agents: { standard: { type: 'claude', model: 'old' }, complex: { type: 'claude', model: 'old' } },
        defaults: { tools: 'readonly', operatorFlag: 42 },
      }),
      'utf8',
    );
    const ctrl = new FakeController();
    await sup(ctrl).applyConfig({ providers: [provider()], tiers: tiers() });
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.defaults).toEqual({ tools: 'readonly', operatorFlag: 42 });
    expect(written.agents.complex.model).toBe('claude-opus-4-8');
  });

  it('remote (non-local) base URL → config written but NO restart, "remote" warning', async () => {
    const ctrl = new FakeController();
    ctrl.mode = 'remote';
    const res = await sup(ctrl).applyConfig({ providers: [provider()], tiers: tiers() });
    expect(existsSync(path)).toBe(true);
    expect(ctrl.calls).not.toContain('gracefulRestart');
    expect(res.warnings.join(' ')).toMatch(/remote/i);
  });

  it('main tier unset → allowed, with a "set a Main tier model" warning', async () => {
    const ctrl = new FakeController();
    const res = await sup(ctrl).applyConfig({
      providers: [provider()],
      tiers: tiers({ main: { model: null } }),
    });
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/main/i);
  });

  it('emits the lifecycle log catalog and NEVER logs the decrypted key or bearer', async () => {
    const events: { event: string; record: Record<string, unknown> }[] = [];
    const ctrl = new FakeController({ healthy: true });
    await new MmaSupervisor({
      configPath: path,
      controller: ctrl,
      secretsByRef: { 'ref-key': SECRET },
      bearerForRedaction: BEARER,
      logSink: (e) => events.push(e as { event: string; record: Record<string, unknown> }),
    }).applyConfig({ providers: [provider({ apiKeyRef: 'ref-key' })], tiers: tiers() });

    const names = events.map((e) => e.event);
    expect(names).toContain('mma.apply.start');
    expect(names).toContain('mma.config.written');
    expect(names).toContain('mma.health.ok');
    // apply.start carries the resolved absolute config path
    const start = events.find((e) => e.event === 'mma.apply.start')!;
    expect(String((start.record as { configPath?: string }).configPath)).toBe(path);
    // No event serializes the secret or bearer anywhere.
    const blob = JSON.stringify(events);
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain(BEARER);
  });

  it('concurrent apply is serialized — the second call is rejected', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowCtrl: ProcessController = {
      isLocal: () => true,
      gracefulRestart: async () => {
        await gate;
      },
      waitHealthy: async () => true,
      activeBatches: async () => 0,
    };
    const s = sup(slowCtrl);
    const first = s.applyConfig({ providers: [provider()], tiers: tiers() });
    const second = await s.applyConfig({ providers: [provider()], tiers: tiers() });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/in progress/i);
    release();
    expect((await first).ok).toBe(true);
  });
});
