// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toRepoSlug, cloneRepoSchema } from '@/git/repos-core';

/**
 * `toRepoSlug` is a security boundary, not a cosmetic one. Its output becomes
 * `path_on_disk` — the directory a repo is cloned into under the team workspace root —
 * so a name that survives with a `/` or `..` in it would place a clone outside that
 * root. The docstring claims path-escapes are neutralized; nothing asserted it.
 *
 * These pin the claim itself, not the formatting: every case below is an input that
 * would traverse or inject if it reached the filesystem intact.
 */
describe('toRepoSlug — path-escape neutralization', () => {
  it('collapses traversal sequences instead of preserving them', () => {
    expect(toRepoSlug('../../etc/passwd')).toBe('etc_passwd');
    expect(toRepoSlug('a/../../b')).toBe('a_b');
    expect(toRepoSlug('/etc/passwd')).toBe('etc_passwd');
  });

  it('reduces a name that is ONLY traversal to the empty string', () => {
    // Empty is the safe outcome: `cloneRepoSchema` rejects it (see below) rather than
    // letting it through as a directory name.
    expect(toRepoSlug('..')).toBe('');
    expect(toRepoSlug('...')).toBe('');
    expect(toRepoSlug('/')).toBe('');
  });

  it('neutralizes Windows separators and drive letters', () => {
    expect(toRepoSlug(String.raw`C:\Windows\System32`)).toBe('c_windows_system32');
  });

  it('strips shell metacharacters and NUL rather than passing them through', () => {
    expect(toRepoSlug('$(whoami)')).toBe('whoami');
    expect(toRepoSlug('a\u0000b')).toBe('a_b');
    expect(toRepoSlug('repo; rm -rf /')).toBe('repo_rm_rf');
  });

  it('never emits a leading or trailing separator', () => {
    for (const name of ['  spaced  ', '__x__', '///a///', '..a..']) {
      const s = toRepoSlug(name);
      expect(s.startsWith('_')).toBe(false);
      expect(s.endsWith('_')).toBe(false);
    }
  });

  it('only ever emits [a-z0-9_]', () => {
    for (const name of ['Self Service Demo', 'my-repo.git', 'café', 'ПРИВЕТ x', '../../etc']) {
      expect(toRepoSlug(name)).toMatch(/^[a-z0-9_]*$/);
    }
  });

  it('produces the documented physical name for an ordinary display name', () => {
    expect(toRepoSlug('Self Service Demo')).toBe('self_service_demo');
    expect(toRepoSlug('my-repo.git')).toBe('my_repo_git');
  });
});

describe('cloneRepoSchema — the slug is enforced at the boundary', () => {
  it('stores the slugged name, not what the caller typed', () => {
    const parsed = cloneRepoSchema.parse({
      name: 'Self Service Demo',
      url: 'https://example.invalid/x.git',
      tags: [],
    });
    expect(parsed.name).toBe('self_service_demo');
  });

  it('rejects a name that slugs away to nothing, rather than cloning into ""', () => {
    for (const name of ['..', '///', '   ...   ']) {
      const r = cloneRepoSchema.safeParse({
        name,
        url: 'https://example.invalid/x.git',
        tags: [],
      });
      expect(r.success).toBe(false);
    }
  });

  it('a traversal attempt is admitted only in its defanged form', () => {
    const parsed = cloneRepoSchema.parse({
      name: '../../etc/passwd',
      url: 'https://example.invalid/x.git',
      tags: [],
    });
    expect(parsed.name).toBe('etc_passwd');
    expect(parsed.name).not.toContain('/');
    expect(parsed.name).not.toContain('.');
  });
});
