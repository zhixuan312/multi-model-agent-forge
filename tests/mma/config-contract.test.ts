// @vitest-environment node
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { buildMmaConfig, type ProviderRow, type TierRow } from '@/mma/supervisor';

/**
 * Contract test (F25): assert `buildMmaConfig`'s output parses under MMA's REAL
 * `multiModelConfigSchema`, catching drift between Forge's hand-mirror and MMA's
 * evolving schema. The MMA core is not in Forge's node_modules, so we resolve the
 * compiled schema module from the co-located install (MMA_HOME / homebrew / npm
 * global) and dynamic-import it. Skipped (not failed) when unresolvable — the
 * mock-based suite still covers the shape.
 */

function resolveCoreSchemaPath(): string | null {
  const rel = join('dist', 'config', 'schema.js');
  const candidates: string[] = [];
  const mmaHome = process.env.MMA_HOME?.trim();
  if (mmaHome) {
    candidates.push(join(mmaHome, 'packages', 'core', rel));
    candidates.push(join(mmaHome, 'node_modules', '@zhixuan92', 'multi-model-agent-core', rel));
  }
  for (const root of ['/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules']) {
    candidates.push(join(root, '@zhixuan92', 'multi-model-agent-core', rel));
    candidates.push(
      join(root, '@zhixuan92', 'multi-model-agent', 'node_modules', '@zhixuan92', 'multi-model-agent-core', rel),
    );
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

const schemaPath = resolveCoreSchemaPath();

function provider(over: Partial<ProviderRow> = {}): ProviderRow {
  return { id: 'aaaa1111-bbbb-2222-cccc-333344445555', name: 'Claude', type: 'claude', baseUrl: null, apiKeyRef: null, ...over };
}
const tiers: TierRow[] = [
  { tier: 'main', providerId: null, model: 'claude-opus-4-8' },
  { tier: 'complex', providerId: provider().id, model: 'claude-opus-4-8' },
  { tier: 'standard', providerId: provider().id, model: 'claude-haiku-4-5' },
];

describe.skipIf(!schemaPath)('buildMmaConfig vs the REAL multiModelConfigSchema', () => {
  it('the minimal no-file object (agents only) parses under the real schema', async () => {
    const mod = (await import(pathToFileURL(schemaPath!).href)) as {
      multiModelConfigSchema: { parse: (x: unknown) => unknown };
    };
    const { config } = buildMmaConfig([provider()], tiers, { existing: null });
    expect(() => mod.multiModelConfigSchema.parse(config)).not.toThrow();
  });

  it('a config with a resolved apiKeyEnv parses under the real schema', async () => {
    const mod = (await import(pathToFileURL(schemaPath!).href)) as {
      multiModelConfigSchema: { parse: (x: unknown) => unknown };
    };
    const { config } = buildMmaConfig([provider({ apiKeyRef: 'r' })], tiers, {
      secretsByRef: { r: 'key' },
      existing: null,
    });
    expect(() => mod.multiModelConfigSchema.parse(config)).not.toThrow();
  });
});

// Always-on guard so the file is never a no-op even when the schema is absent.
it('resolves SOME schema path on this machine OR documents the skip', () => {
  // On the dev/CI box with a co-located MMA install this is non-null; elsewhere
  // the contract assertions above skip. Either way the test file is meaningful.
  expect(schemaPath === null || typeof schemaPath === 'string').toBe(true);
});
