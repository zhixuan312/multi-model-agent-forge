// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { validateTeamWorkspacePath, resolveTeamWorkspaceRoot, toStoredWorkspacePath } from '@/git/workspace-root';

/**
 * FR-8: a team workspace root must be a direct sibling child of the operator base
 * (`<base>/<segment>`), must not equal or nest inside another team's root, and
 * must be rejected if — after symlink/realpath resolution of its parent — it
 * lands outside the base subtree. `realpath` is injected so the rule is unit
 * testable without touching the filesystem (identity = "no symlink indirection").
 *
 * Validation reasons about the RESOLVED ABSOLUTE path; the value handed back to
 * persist is base-relative, which is what keeps a DB dump portable across hosts.
 */
const base = '/forge/base';
const identity = (p: string) => p;

describe('validateTeamWorkspacePath', () => {
  it('accepts a direct child of the base and returns the base-relative leaf to store', () => {
    const r = validateTeamWorkspacePath('/forge/base/alpha', { base, realpath: identity });
    expect(r.ok).toBe(true);
    expect(r.path).toBe('alpha');
    expect(r.absolutePath).toBe('/forge/base/alpha');
  });

  it('resolves a bare segment relative to the base and stores it unchanged', () => {
    const r = validateTeamWorkspacePath('platform', { base, realpath: identity });
    expect(r.ok).toBe(true);
    expect(r.path).toBe('platform');
    expect(r.absolutePath).toBe('/forge/base/platform');
  });

  it('stores the same leaf whether the operator typed the absolute path or the segment', () => {
    // The portability guarantee: the stored row does not record which host wrote it.
    const abs = validateTeamWorkspacePath('/forge/base/acme', { base, realpath: identity });
    const bare = validateTeamWorkspacePath('acme', { base, realpath: identity });
    expect(abs.path).toBe(bare.path);
  });

  it('validates against the resolved absolute path, not the stored leaf', () => {
    // `/etc/secrets` and `/forge/base/secrets` both store as `secrets` — only the
    // one that actually resolves under the base may pass.
    expect(validateTeamWorkspacePath('/etc/secrets', { base, realpath: identity }).ok).toBe(false);
    expect(validateTeamWorkspacePath('/forge/base/secrets', { base, realpath: identity }).ok).toBe(true);
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

describe('toStoredWorkspacePath (create paths, which never validated)', () => {
  it('reduces an absolute candidate to its base-relative leaf', () => {
    expect(toStoredWorkspacePath('/workspace/acme')).toBe('acme');
    expect(toStoredWorkspacePath('  /workspace/acme  ')).toBe('acme');
  });

  it('leaves an already-relative candidate alone', () => {
    expect(toStoredWorkspacePath('acme')).toBe('acme');
  });

  it('returns a leaf-less candidate unchanged rather than an empty string', () => {
    // `workspace_root_path` is NOT NULL — never hand it ''.
    expect(toStoredWorkspacePath('/')).toBe('/');
  });
});

describe('resolveTeamWorkspaceRoot (the absolute cwd MMA receives)', () => {
  const BASE_ENV = process.env.FORGE_WORKSPACE_BASE;
  afterEach(() => {
    if (BASE_ENV === undefined) delete process.env.FORGE_WORKSPACE_BASE;
    else process.env.FORGE_WORKSPACE_BASE = BASE_ENV;
  });

  it('joins the stored relative path onto the operator base', () => {
    process.env.FORGE_WORKSPACE_BASE = '/workspace';
    expect(resolveTeamWorkspaceRoot({ workspaceRootPath: 'acme' })).toBe('/workspace/acme');
  });

  it('follows the CURRENT base — the same row resolves on a host with a different base', () => {
    // This is the portability property: one DB dump, two hosts, no path rewrite.
    process.env.FORGE_WORKSPACE_BASE = '/root/forge-workspace';
    expect(resolveTeamWorkspaceRoot({ workspaceRootPath: 'acme' })).toBe('/root/forge-workspace/acme');
  });

  it('still honours a LEGACY absolute stored value verbatim (backward compatible)', () => {
    // Rows written before migration 0019, or hand-edited ones, must keep resolving.
    process.env.FORGE_WORKSPACE_BASE = '/workspace';
    expect(resolveTeamWorkspaceRoot({ workspaceRootPath: '/forge/base/alpha' })).toBe('/forge/base/alpha');
  });

  it('resolves a legacy relative stored path to absolute — MMA rejects a relative cwd', () => {
    delete process.env.FORGE_WORKSPACE_BASE;
    const r = resolveTeamWorkspaceRoot({ workspaceRootPath: '.forge-workspace' });
    expect(isAbsolute(r)).toBe(true);
    expect(r.endsWith('.forge-workspace')).toBe(true);
  });
});
