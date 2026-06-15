import { uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { PROVIDER_TYPE, AGENT_TIER } from '@/db/enums';

/**
 * Team-config tables (schema.md §1). Spec 2 Part A: DB + UI + secret storage
 * only — the config-supervisor / MmaClient (Part B) is NOT in this slice.
 *
 * Secrets are stored as `*_ref` columns holding an `app_secrets.id` — never the
 * raw token/key. Resolution + decryption is server-side only (SecretStore).
 */

/**
 * `provider` — an LLM provider configured once. `name` is unique. `type` is the
 * API dialect (claude | codex). `base_url` NULL = provider default. `api_key_ref`
 * NULL = provider-default (no stored key); non-NULL = an `app_secrets.id`.
 */
export const provider = forge.table('provider', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(), // "Claude", "Minimax"
  type: text('type', { enum: PROVIDER_TYPE }).notNull(), // claude | codex
  baseUrl: text('base_url'), // NULL = provider default
  apiKeyRef: text('api_key_ref'), // app_secrets.id; NULL = provider default / no key
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `agent_tier` — exactly 3 rows (main, complex, standard), seeded empty by
 * `seed-config.ts`. `provider_id` + `model` are nullable so the seeded rows can
 * exist before configuration; the roster route UPDATEs them by `tier` and never
 * inserts/deletes tier rows. `main` → X-MMA-Main-Model (not an MMA worker tier);
 * `complex`/`standard` → config.agents.{complex,standard}.
 */
export const agentTier = forge.table('agent_tier', {
  tier: text('tier', { enum: AGENT_TIER }).primaryKey(), // main | complex | standard
  providerId: uuid('provider_id').references(() => provider.id), // NULLABLE until configured
  model: text('model'), // NULLABLE until configured; from MMA profiles; custom allowed
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `team_settings` — singleton (one row). Holds the Connections config: the MMA
 * base URL + bearer token ref, the git token ref, and the OpenAI transcription
 * key ref. Per the Part-A brief, all configured columns are NULLABLE until
 * configured (the row is upserted by the single id read first / created on first
 * save). The config-supervisor that consumes these (Part B) is out of scope here.
 */
export const teamSettings = forge.table(
  'settings_connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mmaBaseUrl: text('mma_base_url'), // Connections · MMA base URL
    mmaTokenRef: text('mma_token_ref'), // settings_secret.id, NOT the token
    gitTokenRef: text('git_token_ref'), // settings_secret.id
    openaiTranscriptionKeyRef: text('openai_transcription_key_ref'), // settings_secret.id; voice→text
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Singleton: a unique index on a constant lets at most ONE row exist.
  () => [uniqueIndex('settings_connection_singleton').on(sql`(true)`)],
);
