import { readFileSync } from 'node:fs';

describe('0011_loop_event_triggers.sql', () => {
  it('adds loop mode/token columns, event-trigger traceability columns, and the delivery ledger', () => {
    const sql = readFileSync('src/db/migrations/0011_loop_event_triggers.sql', 'utf8');
    expect(sql).toContain('ALTER TABLE "forge"."loop_def" ADD COLUMN "mode" text');
    expect(sql).toContain('ALTER TABLE "forge"."loop_def" ADD COLUMN "event_token_hash" text');
    expect(sql).toContain('ALTER TABLE "forge"."loop_run" ADD COLUMN "idempotency_key" text');
    expect(sql).toContain('ALTER TABLE "forge"."loop_run" ADD COLUMN "reference" text');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "forge"."loop_event_delivery"');
    expect(sql).toContain('CREATE UNIQUE INDEX "loop_event_delivery_loop_key_idx"');
    expect(sql).toContain('UPDATE "forge"."loop_def" SET "mode" = \'recurring\' WHERE "cron" IS NOT NULL');
    expect(sql).toContain('UPDATE "forge"."loop_def" SET "mode" = \'manual\' WHERE "cron" IS NULL');
  });

  it('extends the trigger check and keeps loop_run dedup off the per-repo table', () => {
    const sql = readFileSync('src/db/migrations/0011_loop_event_triggers.sql', 'utf8');
    expect(sql).toContain('\'schedule\', \'manual\', \'event\'');
    expect(sql).not.toContain('UNIQUE ("loop_id", "idempotency_key")');
  });
});

describe('migration journal', () => {
  it('registers the 0011 migration tag', () => {
    const journal = JSON.parse(readFileSync('src/db/migrations/meta/_journal.json', 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.some((entry) => entry.tag === '0011_loop_event_triggers')).toBe(true);
  });
});
