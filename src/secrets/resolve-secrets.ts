import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';
import type { Db } from '@/db/client';

/**
 * The store to read secrets from: the caller's injected one (tests), else the Postgres
 * store bound to the caller's connection. Duplicated verbatim in connections-core and
 * repos-core, each typed to its own deps interface.
 */
export async function resolveSecrets(deps: { secrets?: SecretStore; db?: Db }): Promise<SecretStore> {
  return deps.secrets ?? (await PostgresSecretStore.create({ db: deps.db }));
}
