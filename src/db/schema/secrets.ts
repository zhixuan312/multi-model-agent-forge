import { uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';

/**
 * `app_secrets` — encrypted secret store; the target of every `*_ref`.
 *
 * `value_enc` is base64(nonce ‖ ciphertext) from libsodium `crypto_secretbox`,
 * keyed by the single 32-byte `FORGE_SECRET_KEY` master key. Decryption is
 * server-side only, on demand, never reaching the browser. Columns are taken
 * verbatim from schema.md §1. `created_by` is a nullable FK → member (seed/system
 * writes leave it NULL); ON DELETE leaves it (no cascade) so the audit ref persists.
 */
export const appSecrets = forge.table('team_secret', {
  id: uuid('id').primaryKey().defaultRandom(), // the value used as a *_ref elsewhere
  label: text('label').notNull(), // human label, e.g. 'git-token', 'openai-transcription'
  valueEnc: text('value_enc').notNull(), // base64(nonce ‖ ciphertext); libsodium secretbox
  createdBy: uuid('created_by').references(() => member.id), // who set it (audit); NULL allowed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
