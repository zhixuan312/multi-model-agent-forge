import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('0010_drop_ops_action_log.sql', () => {
  it('drops ops_action_log only in the guarded follow-up migration', () => {
    const sql = readFileSync('src/db/migrations/0010_drop_ops_action_log.sql', 'utf8');
    expect(sql).toContain('DROP TABLE IF EXISTS "forge"."ops_action_log"');
  });
});
