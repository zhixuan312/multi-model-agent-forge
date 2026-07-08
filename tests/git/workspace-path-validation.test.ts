// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateTeamWorkspacePath } from '@/git/workspace-root';

/**
 * FR-8: a team workspace root must be a direct sibling child of the operator base
 * (`<base>/<segment>`), must not equal or nest inside another team's root, and
 * must be rejected if — after symlink/realpath resolution of its parent — it
 * lands outside the base subtree. `realpath` is injected so the rule is unit
 * testable without touching the filesystem (identity = "no symlink indirection").
 */
const base = '/forge/base';
const identity = (p: string) => p;

describe('validateTeamWorkspacePath', () => {
  it('accepts a direct child of the base and returns its absolute path', () => {
    const r = validateTeamWorkspacePath('/forge/base/alpha', { base, realpath: identity });
    expect(r.ok).toBe(true);
    expect(r.path).toBe('/forge/base/alpha');
  });

  it('resolves a bare segment relative to the base', () => {
    const r = validateTeamWorkspacePath('platform', { base, realpath: identity });
    expect(r.ok).toBe(true);
    expect(r.path).toBe('/forge/base/platform');
  });

  it('rejects an empty path', () => {
    expect(validateTeamWorkspacePath('   ', { base, realpath: identity }).ok).toBe(false);
  });

  it('rejects the base itself (a team root must be BELOW the base)', () => {
    const r = validateTeamWorkspacePath('/forge/base', { base, realpath: identity });
    expect(r.ok).toBe(false);
  });

  it('rejects a nested (grandchild) path — teams are siblings, never nested', () => {
    const r = validateTeamWorkspacePath('/forge/base/alpha/inner', { base, realpath: identity });
    expect(r.ok).toBe(false);
  });

  it('rejects a path outside the base via traversal', () => {
    const r = validateTeamWorkspacePath('/forge/base/../evil', { base, realpath: identity });
    expect(r.ok).toBe(false);
  });

  it('rejects an absolute path in a different subtree', () => {
    const r = validateTeamWorkspacePath('/etc/secrets', { base, realpath: identity });
    expect(r.ok).toBe(false);
  });

  it('rejects a leaf symlink whose canonical target escapes the base', () => {
    // The candidate is lexically a direct child, but the leaf is a symlink that
    // canonicalises outside the base — realpath of the leaf must catch the escape.
    const realpath = (p: string) => (p === '/forge/base/alpha' ? '/somewhere/else/alpha' : p);
    const r = validateTeamWorkspacePath('/forge/base/alpha', { base, realpath });
    expect(r.ok).toBe(false);
  });
});
