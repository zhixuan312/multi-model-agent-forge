// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd());
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');

/**
 * The release contract, expressed as an INVARIANT rather than a snapshot.
 *
 * The "documents the current release" case used to assert the literal string
 * `## 0.1.1 - 2026-07-25`, plus one line of that release's prose. By the time this was
 * read, `package.json` was at 0.1.4 — so the test had been green for three releases while
 * checking that a HISTORICAL entry still existed, which it always would. It could never
 * have caught the thing it is named for: shipping a version with no changelog entry.
 *
 * This is the same failure `migration-transaction-hygiene` calls out for the drizzle
 * journal — pinning "the current last X" makes the test fail on every legitimate addition,
 * or (as here) pass forever while the rule goes unchecked. Derive the version instead.
 */
describe('Forge release contract', () => {
  it('keeps package.json on real semver', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('documents the version package.json actually declares', () => {
    // Accepts both heading forms in the file: bracketed Keep-a-Changelog (`## [0.1.4] - …`)
    // and the bare form the first two releases used (`## 0.1.1 - …`).
    const escaped = pkg.version.replace(/\./g, '\\.');
    const heading = new RegExp(`^## \\[?${escaped}\\]? - \\d{4}-\\d{2}-\\d{2}$`, 'm');
    expect(
      changelog,
      `CHANGELOG.md has no dated heading for the released version ${pkg.version}`,
    ).toMatch(heading);
  });

  it('is a Keep-a-Changelog file with an Unreleased section to write into', () => {
    expect(changelog).toContain('# Changelog');
    expect(changelog).toContain('## [Unreleased]');
  });

  it('lists released versions newest-first', () => {
    // Out-of-order entries make the top of the file stop meaning "latest", which is the
    // one thing a reader relies on.
    const versions = [...changelog.matchAll(/^## \[?(\d+\.\d+\.\d+)\]? - /gm)].map((m) =>
      m[1].split('.').map(Number),
    );
    expect(versions.length).toBeGreaterThan(0);
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [versions[i - 1], versions[i]];
      const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
      expect(newer, `${a.join('.')} must sort before ${b.join('.')}`).toBe(true);
    }
  });
});
