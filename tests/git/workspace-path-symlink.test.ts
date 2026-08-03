// @vitest-environment node
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateTeamWorkspacePath } from '@/git/workspace-root';

/**
 * The doc says the default canonicalises "the leaf if it exists, else the deepest existing
 * ancestor". It did not: the default `realpath` swallowed the error and returned the path
 * UNCHANGED, so the ancestor fallback never ran. Under a symlinked base — the ordinary
 * case on macOS, where /tmp is a symlink to /private/tmp, and common wherever an operator
 * mounts the workspace through one — a not-yet-created team root compared an
 * uncanonicalised parent against the canonical base and was rejected.
 */
describe('a new team root validates under a symlinked base', () => {
  function symlinkedBase(): { base: string; real: string } {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'forge-real-')));
    const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'forge-link-'))), 'base');
    symlinkSync(real, link);
    return { base: link, real };
  }

  it('accepts a directory that does not exist yet', () => {
    const { base } = symlinkedBase();
    const result = validateTeamWorkspacePath('newteam', { base });
    expect(result.reason ?? '').toBe('');
    expect(result.ok).toBe(true);
    expect(result.path).toBe('newteam');
  });

  it('accepts one that already exists', () => {
    const { base, real } = symlinkedBase();
    mkdirSync(join(real, 'existing'));
    expect(validateTeamWorkspacePath('existing', { base }).ok).toBe(true);
  });

  it('still refuses a path outside the base', () => {
    const { base } = symlinkedBase();
    expect(validateTeamWorkspacePath('/etc', { base }).ok).toBe(false);
  });

  it('still refuses a nested path', () => {
    const { base } = symlinkedBase();
    expect(validateTeamWorkspacePath('team/nested', { base }).ok).toBe(false);
  });
});
