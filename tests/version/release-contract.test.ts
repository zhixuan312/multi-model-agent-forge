// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd());

describe('Forge release contract', () => {
  it('keeps package.json on real semver', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('documents the current release in CHANGELOG.md', () => {
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');

    expect(changelog).toContain('# Changelog');
    expect(changelog).toContain('## 0.1.1 - 2026-07-25');
    expect(changelog).toContain('All-in-one image: Forge now carries and supervises its matched MMA engine');
  });
});
