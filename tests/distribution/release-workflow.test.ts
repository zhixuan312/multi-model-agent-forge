// @vitest-environment node
/**
 * The release workflow is the only thing standing between `master` and a published image,
 * and nothing read it.
 *
 * Two properties matter enough to pin. First, the ORDER: the git tag must be created after
 * everything else, because `0.1.3` was tagged and never published — the multi-arch upload
 * outlived the registry token — and an orphaned tag cannot be reused. Second, the release
 * notes are LIFTED from a CHANGELOG section by an awk program, and a version with no such
 * section still published: awk yielded nothing and the Release shipped with only the image
 * block, reading as a release nobody bothered to describe rather than as a mistake.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WF = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

describe('release workflow', () => {
  it('found the workflow', () => {
    expect(WF).toContain('name: release');
    expect(WF).toContain('workflow_dispatch');
  });

  it('gates the tree before building anything', () => {
    for (const cmd of ['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm build', 'pnpm governance:check']) {
      expect(WF, `${cmd} is not a release gate`).toContain(cmd);
    }
    expect(WF).toContain('scripts/check-direction-import-boundary.ts');
    expect(WF, 'the build job must wait for the gates').toContain('needs: gates');
  });

  it('requires a CHANGELOG section for the version being released', () => {
    expect(WF).toContain('CHANGELOG must describe this version');
    // Both halves: the heading must exist AND carry content. A present-but-empty section
    // produces exactly the same empty release notes as a missing one.
    expect(WF).toContain('has no \'## [${{ inputs.version }}]\' section');
    expect(WF).toContain('section is empty');
  });

  /**
   * The gate and the notes-writer must lift the SAME section. Two awk programs that drift
   * means a release passes the gate on one heading and publishes notes from another — or
   * from nothing. Compared as normalised text rather than trusted to stay in step.
   */
  it('the gate and the release-notes writer use the same awk program', () => {
    const programs = [...WF.matchAll(/awk -v v="\$\{\{ inputs\.version \}\}" '([\s\S]*?)'/g)]
      .map((m) => m[1]!.replace(/\s+/g, ' ').trim());
    expect(programs.length, 'expected the gate and the notes writer').toBe(2);
    expect(programs[0]).toBe(programs[1]);
  });

  /**
   * The tag is the proof of a finished release. Everything that can fail must fail first.
   */
  it('creates the git tag after the push, the index gate and the consumer pull', () => {
    const at = (needle: string) => {
      const i = WF.indexOf(needle);
      expect(i, `missing from the workflow: ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    const tag = at('name: Tag the release');
    expect(at('Push ${{ matrix.arch }} by digest')).toBeLessThan(tag);
    expect(at('index must carry BOTH amd64 and arm64')).toBeLessThan(tag);
    expect(at('Consumer verification')).toBeLessThan(tag);
  });

  it('boot-tests each arch against a real Postgres, and proves restart is idempotent', () => {
    // tests/setup.ts deletes DATABASE_URL, so no vitest run covers migrations at all.
    expect(WF).toContain('postgres:17');
    expect(WF).toContain('docker restart forge');
    expect(WF).toMatch(/25P01|duplicate key/);
  });

  it('builds both architectures natively, never under emulation', () => {
    expect(WF).toContain('ubuntu-24.04-arm');
    expect(WF).toContain('linux/amd64');
    expect(WF).toContain('linux/arm64');
  });

  it('refuses a real release from a non-default branch or a mismatched version', () => {
    expect(WF).toContain('Refuse to release from a non-default branch');
    expect(WF).toContain('Version input must match package.json');
    expect(WF).toContain('Tag must not already exist');
  });
});

/**
 * DEPLOYMENT.md §8 kept documenting the workstation build as THE maintainer procedure,
 * while release.yml's own header records that exact path as what left 0.1.3 tagged and
 * unpublished. A runbook and its CI disagreeing about how the artifact is produced sends a
 * maintainer down the path that already failed.
 */
describe('DEPLOYMENT §8 <-> the release workflow', () => {
  const DOC = readFileSync(join(process.cwd(), 'DEPLOYMENT.md'), 'utf8');

  it('points maintainers at the workflow first', () => {
    expect(DOC).toContain('.github/workflows/release.yml');
    expect(DOC).toContain('dry_run');
  });

  it('marks the workstation build as break-glass, not the default', () => {
    expect(DOC).toMatch(/break-glass/i);
  });

  /** The digest's home moved to the GitHub Release; the doc must not send it to CHANGELOG. */
  it('sends the digest to the GitHub Release', () => {
    expect(DOC).toContain('GitHub Release');
    expect(DOC, 'the digest lives in the Release now, not the CHANGELOG')
      .not.toContain('Put that digest in the CHANGELOG entry');
  });
});
