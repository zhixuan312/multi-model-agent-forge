// @vitest-environment node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The declared runtime floor, e.g. ">=22.0.0". */
const enginesNode: string = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { engines: { node: string } }
).engines.node;

/** Major version out of a range like ">=22.0.0" → 22. */
function majorOf(range: string): number {
  const m = range.match(/(\d+)/);
  if (!m) throw new Error(`cannot read a major version from engines.node "${range}"`);
  return Number(m[1]);
}

describe('distribution docs contract', () => {
  it('keeps the README bootstrap aligned with the real scripts and Node engine', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    // DERIVED from package.json, never a hardcoded literal. This assertion used to spell
    // out "Node >= 20.9.0", so it kept passing while `engines`, the Dockerfile, CI and the
    // bundled engine had all moved on — locking the README to a stale number instead of to
    // the truth.
    expect(readme).toContain(`Node >= ${majorOf(enginesNode)}`);
    expect(readme).toContain('pnpm db:migrate');
    expect(readme).toContain('pnpm db:seed-templates');
    expect(readme).not.toMatch(/pnpm db:push(\s|$)/);
    expect(readme).not.toMatch(/pnpm db:seed(\s|$)/);
  });

  it('declares a Node floor the Dockerfile and CI actually run on', () => {
    // The drift this catches: `engines` said >=20.9.0 while every `FROM node:` line was 22,
    // CI used 22, and the bundled MMA engine requires >=22 — so a Node 20 install passed
    // `pnpm install` and then failed at runtime on the co-process.
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
    const bases = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) expect(base).toBeGreaterThanOrEqual(majorOf(enginesNode));
    // Every stage must agree with every other — a mixed-base image is its own bug.
    expect(new Set(bases).size).toBe(1);

    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    for (const m of workflow.matchAll(/node-version:\s*'?(\d+)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(majorOf(enginesNode));
    }
  });

  it('documents every env var Forge actually reads at runtime', () => {
    // Derived, not listed. The previous version asserted a hand-maintained array, so its
    // name was a claim the test could not check: a newly-read variable stayed invisible
    // until someone remembered to add it here. Now a var read anywhere in the shipped
    // code must appear in .env.example or this fails.
    const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    const documented = new Set(
      [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!),
    );

    // Provided by the runtime, not by the operator — nothing to document.
    const FRAMEWORK_PROVIDED = new Set(['NEXT_RUNTIME']);

    const roots = ['src', 'app', 'scripts'];
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (/\.(ts|tsx|mjs)$/.test(e.name) && !e.name.includes('.test.')) out.push(full);
      }
      return out;
    };
    const files = [
      ...roots.flatMap((r) => (existsSync(join(process.cwd(), r)) ? walk(join(process.cwd(), r)) : [])),
      join(process.cwd(), 'instrumentation.ts'),
      join(process.cwd(), 'middleware.ts'),
    ];

    const read = new Map<string, string>();
    for (const f of files) {
      if (!existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) {
        const key = (m[1] ?? m[2])!;
        if (!read.has(key)) read.set(key, f.replace(process.cwd() + '/', ''));
      }
    }

    // Sanity: the scan found real code, so an empty result cannot pass vacuously.
    expect(read.size).toBeGreaterThan(20);

    const undocumented = [...read.entries()]
      .filter(([k]) => !documented.has(k) && !FRAMEWORK_PROVIDED.has(k))
      .map(([k, f]) => `${k} (read in ${f})`);
    expect(undocumented, 'env vars read in code but absent from .env.example').toEqual([]);
  });
});

describe('GUIDELINES <-> in-app guide', () => {
  /**
   * GUIDELINES.md's "mirror note" names the `forge`-group section ids by hand. It used to
   * point at `multi-model-agent-telemetry-frontend/docs/direction-parity-checklist.md` as
   * the way to keep the two in sync — a file that does not exist in any repo, so the
   * instruction was unfollowable and nothing noticed. Derive the ids from the code instead
   * of restating them, so adding or renaming a forge guide section fails here until the
   * document is updated too.
   */
  it('names exactly the forge-group section ids that guide-nav actually defines', async () => {
    const { GUIDE_NAV_SECTIONS } = await import('@/content/guide-nav');
    const guidelines = readFileSync(join(process.cwd(), 'GUIDELINES.md'), 'utf8');

    const forgeIds = GUIDE_NAV_SECTIONS.filter((s) => s.part === 'forge').map((s) => s.id);
    expect(forgeIds.length).toBeGreaterThan(0);

    for (const id of forgeIds) {
      expect(guidelines).toContain(`\`${id}\``);
    }
    // and does not advertise a forge section that no longer exists
    const cited = [...guidelines.matchAll(/`(forge-[a-z-]+)`/g)].map((m) => m[1]);
    expect([...new Set(cited)].sort()).toEqual([...forgeIds].sort());
  });

  it('does not point at the checklist file that never existed', () => {
    const guidelines = readFileSync(join(process.cwd(), 'GUIDELINES.md'), 'utf8');
    expect(guidelines).not.toMatch(/Keep them in sync via/);
  });
});

describe('README <-> the real stage lifecycle', () => {
  /**
   * README printed a FOUR-stage arrow ("explore → plan → build → review") in two places
   * while the product has SIX stages, and used "build" as a stage name — `build` is a
   * PHASE (`design`/`build`/`learn`); the stage is `execute`, served at `/execute`.
   *
   * Derived from `STAGE_ROUTE`, not restated, so adding or renaming a stage fails here
   * instead of leaving the front-door doc describing a lifecycle the product does not have.
   */
  it('names every stage segment, in order, wherever it prints the lifecycle arrow', async () => {
    const { STAGE_ROUTE } = await import('@/projects/stage-route');
    const { STAGE_KIND } = await import('@/db/enums');
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    const arrow = STAGE_KIND.map((k) => STAGE_ROUTE[k]).join(' → ');
    expect(readme, `README should print the full stage arrow: ${arrow}`).toContain(arrow);
    // and must not still claim the old four-stage shape
    expect(readme).not.toContain('explore → plan → build → review');
  });

  it('lists every stage LABEL in the pillars section', async () => {
    const { STAGE_LABEL } = await import('@/projects/stage-lifecycle');
    const { STAGE_KIND } = await import('@/db/enums');
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    for (const kind of STAGE_KIND) {
      expect(readme, `README should name the "${STAGE_LABEL[kind]}" stage`).toContain(`**${STAGE_LABEL[kind]}**`);
    }
  });
});

