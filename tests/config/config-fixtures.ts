// Shared live-DB fixtures for Spec-2 config integration tests. Everything created
// here uses a throwaway prefix so cleanup is exhaustive and never touches real
// rows.
import { sql, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { provider, teamSettings, agentTier } from '@/db/schema/config';
import { appSecrets } from '@/db/schema/secrets';
import type { SecretStore } from '@/secrets/secret-store';

/** Prefix every throwaway provider name + secret label so cleanup is precise. */
export const TEST_PREFIX = '__forge_cfg_test__';

export function uniqueName(label = 'p'): string {
  return `${TEST_PREFIX}${label}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * In-memory SecretStore for unit-level core tests — records puts/deletes so a
 * test can assert the plaintext never reached a DB column without standing up
 * the real encrypted store. Resolves a real ref string per put.
 */
// Module-global so refs are unique ACROSS fake-store instances (a rotation test
// uses two stores and must not see the second store re-mint a colliding ref_1).
let fakeRefCounter = 0;

export function makeFakeSecretStore(): SecretStore & {
  readonly puts: Array<{ label: string; plaintext: string; ref: string }>;
  readonly deleted: string[];
} {
  const puts: Array<{ label: string; plaintext: string; ref: string }> = [];
  const deleted: string[] = [];
  const values = new Map<string, string>();
  return {
    puts,
    deleted,
    async put(label, plaintext) {
      const ref = `${TEST_PREFIX}ref_${(fakeRefCounter += 1)}`;
      puts.push({ label, plaintext, ref });
      values.set(ref, plaintext);
      return ref;
    },
    async get(id) {
      return values.get(id) ?? null;
    },
    async delete(id) {
      deleted.push(id);
      values.delete(id);
    },
  };
}

/** Delete every throwaway provider + secret + team_settings row; reset tiers. */
export async function cleanupConfig(): Promise<void> {
  const db = getDb();
  // Detach any tier rows pointing at throwaway providers, then reset all tiers
  // to the seeded NULL state (tests may have set them).
  await db.update(agentTier).set({ providerId: null, model: null });
  await db.delete(provider).where(sql`${provider.name} LIKE ${TEST_PREFIX + '%'}`);
  await db.delete(appSecrets).where(sql`${appSecrets.label} LIKE ${TEST_PREFIX + '%'}`);
  await db.delete(appSecrets).where(
    inArray(appSecrets.label, ['mma-bearer', 'git-token', 'openai-transcription']),
  );
  // team_settings is a singleton with no name; tests that touch it clean it here.
  await db.delete(teamSettings);
}

/** Insert a throwaway provider directly (bypassing the core) for FK targets. */
export async function seedTestProvider(opts?: {
  type?: 'claude' | 'codex';
  label?: string;
}): Promise<{ id: string; name: string }> {
  const db = getDb();
  const name = uniqueName(opts?.label);
  const [row] = await db
    .insert(provider)
    .values({ name, type: opts?.type ?? 'claude' })
    .returning({ id: provider.id, name: provider.name });
  return row;
}

export { eq };
