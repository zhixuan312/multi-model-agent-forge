// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every git subprocess must run with a SCRUBBED environment.
 *
 * Git children run in checkouts MMA workers write to, and several of these commands fire
 * repo hooks — `push` runs pre-push, `worktree add`/`checkout` run post-checkout. A
 * planted hook inheriting the parent environment would receive FORGE_SECRET_KEY,
 * DATABASE_URL and every provider key. `safeChildEnv` keeps PATH and HOME, so git stays
 * findable and a credential helper in ~/.gitconfig keeps working.
 *
 * This checks the SPAWN SITES rather than any one runner, because the calls are spread
 * across the loop runner, the workspace service, the execute/review handlers and the
 * workspace sync — a new one is the likely regression, not a change to an existing one.
 */
const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [rel] : [];
  });
}

describe('git subprocesses run with a scrubbed environment', () => {
  /**
   * Each call is checked by its OWN argument list, not by a window of nearby lines: the
   * first version scanned a few lines either side, so a neighbouring call's `env:`
   * satisfied the check for a call that had none — and removing the env from a push
   * passed under sabotage.
   */
  const offenders: string[] = [];
  for (const rel of [...sources('src'), ...sources('app')]) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync|execSync)\s*\(\s*'git'/g)) {
      // Take the call's arguments: from the opening paren to the matching close.
      let depth = 0;
      let end = m.index!;
      for (let i = text.indexOf('(', m.index!); i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      const call = text.slice(m.index!, end + 1);
      let hasEnv = /\benv\s*:/.test(call);
      if (!hasEnv) {
        // An options IDENTIFIER counts when its declaration carries an env.
        for (const id of call.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*\)\s*$/g)) {
          const decl = new RegExp(`const ${id[1]}\\s*(?::[^=]+)?=\\s*\\{[^}]*\\benv\\s*:`);
          if (decl.test(text)) hasEnv = true;
        }
      }
      if (!hasEnv) offenders.push(`${rel}:${text.slice(0, m.index!).split('\n').length}`);
    }
  }

  it('found the spawn sites', () => {
    const anyGit = [...sources('src')].some((rel) =>
      /execFileSync\('git'|execFile\(\s*'git'|spawn\('git'/.test(readFileSync(join(ROOT, rel), 'utf8')));
    expect(anyGit).toBe(true);
  });

  it('every git spawn passes an explicit env', () => {
    expect(offenders, 'pass env: safeChildEnv() — a git hook must not see Forge secrets').toEqual([]);
  });
});
