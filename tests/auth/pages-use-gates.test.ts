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
   * A GATE is `if (<role test>) … redirect(...)` — a role deciding whether you may be here
   * at all. Comparing `role` for any other purpose is fine and common: `settings/page.tsx`
   * picks a landing DESTINATION (every branch redirects somewhere valid), `profile` derives
   * a display label, `workspace` derives an `isAdmin` capability flag for the client, and
   * `usage` chooses which dashboard to RENDER. None of those is an access decision, and an
   * earlier version of this rule flagged all four.
   *
   * The redirect is looked for in the STATEMENT OR BLOCK the condition opens, not on the
   * same line. The rule was `\)\s*redirect\(` — adjacency — so it saw
   *
   *     if (me.role !== 'org_admin') redirect('/');
   *
   * and missed
   *
   *     if (me.role !== 'org_admin') {
   *       redirect('/');
   *     }
   *
   * which is the form anyone writing a real gate would reach for, and the form a formatter
   * produces. The check was blind to the more likely way of committing the thing it forbids.
   */
  it('no page open-codes a role gate', () => {
    const CONDITION = /if\s*\((?:[^()]|\([^()]*\))*\brole\s*[!=]==(?:[^()]|\([^()]*\))*\)/g;
    const offenders: string[] = [];
    for (const rel of files) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of src.matchAll(CONDITION)) {
        const after = src.slice(m.index! + m[0].length);
        // The consequent: a braced block, or everything up to the first `;`.
        const body = after.trimStart().startsWith('{')
          ? after.slice(after.indexOf('{'), after.indexOf('}') + 1)
          : after.slice(0, after.indexOf(';') + 1);
        if (/\bredirect\(/.test(body)) offenders.push(rel);
      }
    }
    expect([...new Set(offenders)], 'use a require*Page gate from @/auth/require-admin').toEqual([]);
  });

  /**
   * The detector, on both spellings. Without this the widened rule could regress to
   * adjacency-only and still look like it was checking something.
   */
  it('the detector catches a braced gate, not just a one-liner', () => {
    const CONDITION = /if\s*\((?:[^()]|\([^()]*\))*\brole\s*[!=]==(?:[^()]|\([^()]*\))*\)/;
    const braced = "if (me.role !== 'org_admin') {\n  redirect('/');\n}";
    const oneLine = "if (me.role !== 'org_admin') redirect('/');";
    const render = "if (me.role === 'org_admin') {\n  return <Dashboard />;\n}";
    for (const [src, expected] of [[braced, true], [oneLine, true], [render, false]] as const) {
      const m = CONDITION.exec(src);
      expect(m, `condition not matched in: ${src}`).toBeTruthy();
      const after = src.slice(m!.index + m![0].length);
      const body = after.trimStart().startsWith('{')
        ? after.slice(after.indexOf('{'), after.indexOf('}') + 1)
        : after.slice(0, after.indexOf(';') + 1);
      expect(/\bredirect\(/.test(body), `wrong verdict for: ${src}`).toBe(expected);
    }
  });
});
