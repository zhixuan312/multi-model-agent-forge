import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { teamSettings } from '@/db/schema/config';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';
import { USE_MOCK } from '@/mock/config';
import * as connectionsMock from '@/mock/domains/settings/connections';

/**
 * Connections core (Spec 2 §Connections). Reads/updates the singleton
 * `team_settings` row: MMA (base URL + bearer token) and Git (service token),
 * plus the OpenAI transcription key. Read-or-create-by-id: the first save
 * creates the single row; later saves UPDATE it. Each section updates
 * independently (an MMA-only edit leaves the git ref untouched).
 *
 * Secrets (MMA bearer, git token, transcription key) are NEVER stored raw — each
 * is `SecretStore.put`'d and only the returned `app_secrets.id` lands in the
 * matching `*_ref`. Secret values are NEVER returned to callers — the view
 * exposes "set / not set" booleans only.
 */

export interface ConnectionsDeps {
  db?: Db;
  secrets?: SecretStore;
}

async function resolveSecrets(deps: ConnectionsDeps): Promise<SecretStore> {
  return deps.secrets ?? (await PostgresSecretStore.create({ db: deps.db }));
}

/** The Connections view — base URL is shown; tokens are booleans, never values. */
export interface ConnectionsView {
  mmaBaseUrl: string | null;
  mmaTokenSet: boolean;
  gitTokenSet: boolean;
  openaiTranscriptionKeySet: boolean;
}

const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .optional();

// All fields optional → each section saves independently. A present token
// rotates that secret; an absent token leaves the existing ref untouched.
export const updateConnectionsSchema = z.object({
  mmaBaseUrl: optionalText,
  mmaToken: optionalText,
  gitToken: optionalText,
  openaiTranscriptionKey: optionalText,
});
export type UpdateConnectionsInput = z.infer<typeof updateConnectionsSchema>;

/** Read the singleton row (or the empty view if no row exists yet). */
export async function getConnections(deps: ConnectionsDeps = {}): Promise<ConnectionsView> {
  if (USE_MOCK) return connectionsMock.getConnections();
  const db = deps.db ?? getDb();
  const [row] = await db.select().from(teamSettings).limit(1);
  if (!row) {
    return {
      mmaBaseUrl: null,
      mmaTokenSet: false,
      gitTokenSet: false,
      openaiTranscriptionKeySet: false,
    };
  }
  return {
    mmaBaseUrl: row.mmaBaseUrl,
    mmaTokenSet: row.mmaTokenRef !== null,
    gitTokenSet: row.gitTokenRef !== null,
    openaiTranscriptionKeySet: row.openaiTranscriptionKeyRef !== null,
  };
}

export type UpdateConnectionsResult =
  | { kind: 'saved'; connections: ConnectionsView }
  | { kind: 'invalid' };

/**
 * Save (create-or-update) the singleton row. Only the provided fields are
 * touched: a token present is `put` and its ref replaces the old one; a token
 * absent leaves its ref as-is. The base URL is set when provided.
 */
export async function updateConnections(
  input: unknown,
  deps: ConnectionsDeps = {},
): Promise<UpdateConnectionsResult> {
  if (USE_MOCK) return connectionsMock.updateConnections(input);
  const db = deps.db ?? getDb();
  const parsed = updateConnectionsSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const { mmaBaseUrl, mmaToken, gitToken, openaiTranscriptionKey } = parsed.data;

  const [existing] = await db.select().from(teamSettings).limit(1);

  // Resolve any provided secrets to refs (replacing the prior secret rows).
  let secrets: SecretStore | null = null;
  const needSecrets =
    mmaToken !== undefined || gitToken !== undefined || openaiTranscriptionKey !== undefined;
  if (needSecrets) secrets = await resolveSecrets(deps);

  async function rotate(
    plaintext: string | undefined,
    label: string,
    priorRef: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (plaintext === undefined) return undefined; // unchanged
    const ref = await secrets!.put(label, plaintext);
    if (priorRef) await secrets!.delete(priorRef); // drop the superseded secret
    return ref;
  }

  const mmaTokenRef = await rotate(mmaToken, 'mma-bearer', existing?.mmaTokenRef);
  const gitTokenRef = await rotate(gitToken, 'git-token', existing?.gitTokenRef);
  const openaiRef = await rotate(
    openaiTranscriptionKey,
    'openai-transcription',
    existing?.openaiTranscriptionKeyRef,
  );

  if (existing) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (mmaBaseUrl !== undefined) patch.mmaBaseUrl = mmaBaseUrl;
    if (mmaTokenRef !== undefined) patch.mmaTokenRef = mmaTokenRef;
    if (gitTokenRef !== undefined) patch.gitTokenRef = gitTokenRef;
    if (openaiRef !== undefined) patch.openaiTranscriptionKeyRef = openaiRef;
    await db.update(teamSettings).set(patch).where(eq(teamSettings.id, existing.id));
  } else {
    await db.insert(teamSettings).values({
      mmaBaseUrl: mmaBaseUrl ?? null,
      mmaTokenRef: mmaTokenRef ?? null,
      gitTokenRef: gitTokenRef ?? null,
      openaiTranscriptionKeyRef: openaiRef ?? null,
    });
  }

  return { kind: 'saved', connections: await getConnections({ db }) };
}
