// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAdminRole } from '@/db/enums';

/**
 * "Counts as an admin" is one rule. It had been spelled out four times — the route gate,
 * the page redirect, the sidebar's adminOnly filter (which decides what a user can SEE,
 * so a miss there hides a feature silently rather than erroring) and the members list —
 * plus a members-core shim that also accepted a legacy `isAdmin` boolean for a column the
 * schema no longer has.
 *
 * The check looks for the BOOLEAN form (both roles joined by `||`/`&&`), not for the two
 * names appearing together: a per-role label switch is a different thing, and flagging
 * `role === 'org_admin' ? 'Org admin' : …` would make this noise someone turns off.
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

describe('the admin-role test has one definition', () => {
  it('still recognises exactly the two admin roles', () => {
    expect(isAdminRole('org_admin')).toBe(true);
    expect(isAdminRole('team_admin')).toBe(true);
    expect(isAdminRole('member')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('is not open-coded anywhere else', () => {
    const offenders: string[] = [];
    for (const rel of [...sources('src'), ...sources('app')]) {
      if (rel === 'src/db/enums.ts') continue;
      const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes('?')) return;                       // a per-role label switch
        if (!/['"]org_admin['"]/.test(line)) return;
        if (!/['"]team_admin['"]/.test(line)) return;
        if (!/\|\||&&/.test(line)) return;                    // boolean form only
        offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, 'use isAdminRole from @/db/enums').toEqual([]);
  });
});
