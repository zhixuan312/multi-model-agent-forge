// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Eleven pages open-coded a role gate. Four of the org ones sent an unauthenticated
 * visitor to `/` rather than `/login` — drift that only appears when you line the copies
 * up. The gates in `@/auth/require-admin` are the one place these decisions live.
 */
const ROOT = process.cwd();

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...pages(rel));
    else if (e.name === 'page.tsx' || e.name === 'layout.tsx') out.push(rel);
  }
  return out;
}

describe('pages do not open-code role gates', () => {
  const files = pages('app');

  it('scanned the app tree', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  /**
   * A GATE is `if (<role test>) redirect(...)` — a role deciding whether you may be here
   * at all. Comparing `role` for any other purpose is fine and common: `app/page.tsx` and
   * `settings/page.tsx` pick a landing DESTINATION (every branch redirects somewhere
   * valid), `profile` derives a display label, `workspace` derives an `isAdmin` capability
   * flag for the client, and `usage` chooses which dashboard to render. None of those is
   * an access decision, and an earlier version of this rule flagged all four.
   */
  it('no page open-codes a role gate', () => {
    const GATE = /if\s*\([^)]*\brole\s*[!=]==[^)]*\)\s*redirect\(/;
    const offenders = files.filter((rel) => GATE.test(readFileSync(join(ROOT, rel), 'utf8')));
    expect(offenders, 'use a require*Page gate from @/auth/require-admin').toEqual([]);
  });
});
