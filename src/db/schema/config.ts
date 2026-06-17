import { uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';

/**
 * Team-config tables.
 *
 * Per-tier model config is NOT stored in the DB: the Models tab configures it
 * through the engine's `POST /configure-provider`, which persists to the
 * engine's `~/.mma/config.json` (the single source of truth) + its own keystore.
 * Forge reads config.json for display + to resolve the main-tier model.
 *
 * Secrets are stored as `*_ref` columns holding a `settings_secret.id` — never
 * the raw token/key. Resolution + decryption is server-side only (SecretStore).
 */

/**
 * `team_connection` — singleton (one row). Holds the Connections config: the
 * MMA base URL, the git token ref, and the speech-to-text (OpenAI) key ref. The
 * MMA bearer is NOT stored here — it is owned by the local mma (read from its
 * auth-token file). All configured columns are NULLABLE until configured (the row
 * is upserted: read-first by id / created on first save).
 */
export const connectionSettings = forge.table(
  'team_connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mmaBaseUrl: text('mma_base_url'), // Connections · MMA base URL
    gitTokenRef: text('git_token_ref'), // settings_secret.id
    openaiTranscriptionKeyRef: text('openai_transcription_key_ref'), // settings_secret.id; speech→text
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Singleton: a unique index on a constant lets at most ONE row exist.
  () => [uniqueIndex('settings_connection_singleton').on(sql`(true)`)],
);
