// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEAM_ROLE } from '@/db/enums';

/**
 * Members carry a `role` column, not an `is_admin` boolean. Five comments still described
 * the old column — including the one on `setMemberAdmin` itself, which is what made a set
 * of test fixtures supplying `{ isAdmin: true }` rows look correct while production
 * selects `{ id, role }`.
 *
 * `isAdmin` survives as a WIRE field on the members API, so this checks for the COLUMN
 * spelling (`is_admin`), which only ever refers to storage.
 */
const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

describe('no code describes an is_admin column', () => {
  it('the role enum is what the schema actually has', () => {
    expect([...TEAM_ROLE]).toContain('org_admin');
    expect([...TEAM_ROLE]).toContain('team_admin');
  });

  it('nothing mentions the removed column', () => {
    const offenders = [...sources('src'), ...sources('app')].filter((rel) => {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      // Allow the one place that explains the wire/storage split.
      if (rel === 'src/auth/members-core.ts') return false;
      return /\bis_admin\b/.test(text);
    });
    expect(offenders, 'members carry a `role` column — say role, not is_admin').toEqual([]);
  });
});
