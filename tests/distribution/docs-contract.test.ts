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

  /**
   * A command NOTHING schedules must be written down, or it never runs. The session
   * reaper is the case in point: `session-reaper.ts` says outright "run on a schedule
   * (cron/systemd timer)… no in-app scheduler", and the README did not mention it, so a
   * deployed instance accumulated expired sessions forever with nobody told to act.
   *
   * Keyed on the scripts themselves, so adding another operator-run command and leaving
   * it undocumented fails here.
   */
  it('documents the maintenance commands no scheduler runs', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    const scripts = (
      JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    ).scripts;
    // `db:seed-journal` is here because it is the DESTRUCTIVE one: it deletes the team
    // journal's nodes/ before writing the demo dataset. It sat in package.json beside
    // `db:seed-templates` — which the bootstrap section tells operators to run — and
    // appeared in no documentation at all, so the only way to learn what it does was to
    // read the source.
    const OPERATOR_RUN = ['db:reap', 'db:migrate-artifacts', 'db:seed-journal'];
    for (const script of OPERATOR_RUN) {
      expect(scripts, `${script} is claimed here but not in package.json`).toHaveProperty(script);
      expect(readme, `${script} runs only when an operator runs it — say so in the README`)
        .toContain(`pnpm ${script}`);
    }
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

/**
 * The release runbook asks an operator to eyeball per-tier provider parity across
 * `.env.example`, `docker-compose.yml` and the bootstrap with an `rg -c`. Nothing enforced
 * it, and the README had already regressed to the old single-`PROVIDER`, Anthropic-only
 * framing — contradicting a paragraph three sections above it in the same file. Derive the
 * knobs from the script that READS them, so a new tier variable cannot ship undocumented.
 */
/**
 * Every image tag an OPERATOR is told to run must be the version this repo ships.
 * DEPLOYMENT.md sat on `0.1.1` for three releases while the README moved to `0.1.4`, so the
 * two front-door documents told an operator to run different images. CHANGELOG entries are
 * exempt on purpose — a historical entry naming its own release is the point.
 */
describe('docs <-> the version this repo ships', () => {
  it('pins every runnable image tag to package.json#version', () => {
    const version = (
      JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
    ).version;

    const stale: string[] = [];
    for (const file of ['README.md', 'DEPLOYMENT.md', 'docker-compose.yml']) {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      for (const m of text.matchAll(/ghcr\.io\/zhixuan312\/forge:(\d+\.\d+\.\d+)/g)) {
        if (m[1] !== version) stale.push(`${file} runs forge:${m[1]}, but this repo is ${version}`);
      }
      for (const m of text.matchAll(/FORGE_IMAGE_TAG=(\d+\.\d+\.\d+)/g)) {
        if (m[1] !== version) stale.push(`${file} sets FORGE_IMAGE_TAG=${m[1]}, but this repo is ${version}`);
      }
    }
    expect(stale).toEqual([]);
  });
});

describe('per-tier provider contract <-> the docs that describe it', () => {
  it('documents every per-tier env knob the container bootstrap reads', () => {
    const bootstrap = readFileSync(join(process.cwd(), 'scripts/container-bootstrap.mjs'), 'utf8');

    // `PROVIDER_${tier.toUpperCase()}` / `API_KEY_ENV_${T}` etc. — collect the PREFIXES the
    // script builds tier names onto, then expand them over the three real tiers.
    const prefixes = [...new Set(
      [...bootstrap.matchAll(/([A-Z][A-Z0-9_]*_)\$\{(?:tier\.toUpperCase\(\)|T)\}/g)].map((m) => m[1]!),
    )];
    expect(prefixes.length, 'no per-tier env prefixes found — did the bootstrap change shape?')
      .toBeGreaterThanOrEqual(4);

    const TIERS = ['STANDARD', 'COMPLEX', 'MAIN'];
    const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    const missing: string[] = [];
    for (const prefix of prefixes) {
      // `.env.example` and compose list every tier explicitly; the README describes the
      // family once, as `PREFIX<TIER>`.
      for (const tier of TIERS) {
        const name = `${prefix}${tier}`;
        if (!envExample.includes(name)) missing.push(`${name} absent from .env.example`);
        if (!compose.includes(name)) missing.push(`${name} absent from docker-compose.yml`);
      }
      if (!readme.includes(`${prefix}<TIER>`)) {
        missing.push(`${prefix}<TIER> absent from README.md`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('does not reduce the provider contract to one vendor', () => {
    // `PROVIDER` names a wire PROTOCOL and is only the default for tiers with no override.
    // Both files below once told operators to set `PROVIDER=anthropic` and stop there.
    for (const file of ['README.md', '.env.example']) {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      expect(text, `${file} should not present PROVIDER as an all-tier vendor switch`)
        .not.toMatch(/one strict config for all three tiers/);
    }
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

  /**
   * The mirror note states, as a number, how many `##` headings this document has versus
   * how many sections the guide group carries — the reason it tells you to treat the two
   * as a coverage obligation rather than a diff. Both counts are hand-written, so both can
   * quietly stop being true; derive them.
   */
  it('states heading counts that are actually true', async () => {
    const { GUIDE_NAV_SECTIONS } = await import('@/content/guide-nav');
    const guidelines = readFileSync(join(process.cwd(), 'GUIDELINES.md'), 'utf8');

    const headings = [...guidelines.matchAll(/^## .+$/gm)].length;
    const forgeSections = GUIDE_NAV_SECTIONS.filter((s) => s.part === 'forge').length;

    // The claim is a wrapped prose sentence, so match against a whitespace-collapsed copy —
    // otherwise a reflow of the paragraph silently disarms the check.
    const flat = guidelines.replace(/\s+/g, ' ');
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    expect(flat, `GUIDELINES.md has ${headings} '##' headings`)
      .toContain(`this document has ${WORDS[headings] ?? headings} \`##\` headings`);
    expect(flat, `the forge guide group has ${forgeSections} sections`)
      .toContain(`the group has ${WORDS[forgeSections] ?? forgeSections}`);
  });

  it('does not point at the checklist file that never existed', () => {
    const guidelines = readFileSync(join(process.cwd(), 'GUIDELINES.md'), 'utf8');
    expect(guidelines).not.toMatch(/Keep them in sync via/);
  });

  /**
   * The mirror note tells an editor where the guide prose lives, and pointed at
   * `app/(app)/settings/guide/` — two page files and no prose. The prose is in
   * `direction-sections.ts`. A wrong pointer in a coverage obligation is the obligation
   * failing quietly: the editor looks, finds nothing to change, and moves on.
   */
  it('points at the module the guide prose actually lives in', () => {
    const guidelines = readFileSync(join(process.cwd(), 'GUIDELINES.md'), 'utf8');
    expect(guidelines).toContain('src/content/direction-sections.ts');
  });
});

/**
 * Three surfaces were found naming the Reflect stage "Journal" — its ENUM KEY — during the
 * codebase audit: the dispatch-failure notifications, the projects pipeline panel, and the
 * in-app Guide's spine section. A reader who goes looking for a "Journal" stage in the
 * stepper does not find one.
 *
 * Keyed on `STAGE_LABEL`, so this covers any stage whose key and label differ, not just
 * this pair.
 */
describe('user-facing stage names <-> the stepper', () => {
  it('no shipped prose names a stage by its enum key instead of its label', async () => {
    const { STAGE_LABEL } = await import('@/projects/stage-lifecycle');
    const { STAGE_KIND } = await import('@/db/enums');

    // Only kinds whose key differs from what the user is shown can be got wrong this way.
    const renamed = STAGE_KIND.filter((k) => k.toLowerCase() !== STAGE_LABEL[k].toLowerCase());
    expect(renamed.length, 'expected at least one renamed stage to guard').toBeGreaterThan(0);

    const surfaces = ['src/content/direction-sections.ts', 'app/(app)/projects/page.tsx'];
    const offenders: string[] = [];
    for (const file of surfaces) {
      // Comments stripped first. This is the THIRD source-shape ratchet in this codebase to
      // need it — the timezone one and the enum one both tripped on their own fix's
      // explanation, which quotes the string it replaced. Prose describing a mistake is not
      // the mistake; strip comments by default when matching source shapes.
      const text = readFileSync(join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const kind of renamed) {
        // The key used as a BOLD list label or a bold arrow step — the shapes these three
        // instances took. Plain prose using the word (a "journal recall", the team journal)
        // is a different noun and must not trip this.
        const asLabel = new RegExp(`\\*\\*${kind[0]!.toUpperCase()}${kind.slice(1)}\\*\\*`, 'i');
        if (asLabel.test(text)) {
          offenders.push(`${file} shows "${kind}" where the stepper says "${STAGE_LABEL[kind]}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
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

/**
 * The README's route list drifted from the code in both directions at once: it advertised
 * `debug`, which Forge has never dispatched, and omitted `journal_recall`, `journal_record`,
 * `spec` and `plan`, which it dispatches constantly. A reader sizing up the integration got
 * a set that was wrong on both sides.
 *
 * Derived from `MMA_ROUTE`, so the prose cannot say more or less than the code does.
 */
describe('README <-> the routes Forge dispatches', () => {
  it('names every route, and no route that does not exist', async () => {
    const { MMA_ROUTE } = await import('@/db/enums');
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    const line = readme.split('\n').find((l) => l.includes('Forge calls MMA to dispatch work'));
    expect(line, 'the "Relationship to MMA" paragraph moved — repoint this test').toBeTruthy();

    const named = [...line!.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!).filter((n) => n !== 'MMA_ROUTE');
    expect([...named].sort()).toEqual([...MMA_ROUTE].sort());
  });

  /** A written-out count is the half that rots silently once the list is right. */
  it('states a count that matches the list', async () => {
    const { MMA_ROUTE } = await import('@/db/enums');
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
      'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain(`${WORDS[MMA_ROUTE.length]} routes`);
  });
});

/**
 * A stage chain written out in prose must be the real chain.
 *
 * DEPLOYMENT.md told operators the SDLC is "Explore → Spec → Plan → Build → Review" —
 * naming a stage that does not exist and dropping one that does. `Build` is a PHASE
 * (`design` · `build` · `learn`); the stage is `Execute`, and `Reflect` closes the chain.
 * README warns about exactly that confusion two files away, which is how a reader ends up
 * with two front-door documents disagreeing about what the product's own steps are called.
 *
 * Matched loosely on separator and case so a doc may write `explore → spec → …` in a code
 * block or `Explore → Spec → …` in prose — the ORDER and the MEMBERSHIP are the claims.
 *
 * Complements, and does not replace, `README <-> the real stage lifecycle` above: that one
 * asserts the README CONTAINS the full arrow and every label, which is a presence check on
 * one file. This one checks that every chain any of the three docs prints is CORRECT. The
 * README-only scope of the older test is precisely why DEPLOYMENT.md still said "Build".
 */
describe('docs <-> the SDLC stage chain', () => {
  it('every written-out chain matches STAGE_LABEL, in order', async () => {
    const { STAGE_ORDER } = await import('@/db/enums');
    const { STAGE_LABEL } = await import('@/projects/stage-lifecycle');
    const canonical = STAGE_ORDER.map((k) => STAGE_LABEL[k].toLowerCase());

    // Two legitimate vocabularies: the UI LABELS (Explore … Reflect), which the
    // operator-facing docs use, and the stage KEYS (`exploration` … `journal`), which
    // GUIDELINES uses because it talks about the schema. Either is fine; a chain missing a
    // member is not, and that is what this catches — GUIDELINES stopped at Review, and
    // DEPLOYMENT wrote "Build", a PHASE, in the Execute slot.
    const ALIASES: Record<string, string> = { exploration: 'explore', journal: 'reflect' };
    const norm = (s: string) => {
      const k = s.trim().toLowerCase();
      return ALIASES[k] ?? k;
    };

    const wrong: string[] = [];
    for (const file of ['README.md', 'DEPLOYMENT.md', 'GUIDELINES.md']) {
      // Blockquote markers stripped and whitespace collapsed BEFORE matching. A chain
      // wrapped across lines (`… → Spec\n> → Plan → …`) otherwise matches only its tail,
      // and a partial chain reads as a wrong one — the check would fail honest prose and
      // pass a genuinely short chain that happened to sit on one line.
      const text = readFileSync(join(process.cwd(), file), 'utf8')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\s+/g, ' ');
      // A run of ≥4 arrow-separated words — long enough to be a stage chain, not a phrase.
      for (const m of text.matchAll(/([A-Za-z]+(?:\s*→\s*[A-Za-z]+){3,})/g)) {
        const parts = m[1].split('→').map(norm);
        // Recognise a chain by MAJORITY, then validate all of it.
        //
        // This first required EVERY part to be canonical, and passed its own sabotage:
        // restoring "Explore → Spec → Plan → Build → Review" — the original bug — made
        // `Build` non-canonical, so the whole chain was skipped as "not a stage chain".
        // The defect disqualified the check designed to find it. A majority test still
        // ignores unrelated arrow lists (a boot order matches none of these words) while
        // catching the one-wrong-name case that actually shipped.
        const known = parts.filter((p) => canonical.includes(p)).length;
        if (known < 3 || known <= parts.length / 2) continue;
        if (parts.join(' → ') !== canonical.join(' → ')) {
          wrong.push(`${file}: "${m[1].trim()}" — the chain is ${canonical.join(' → ')}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('found chains to check — a broken matcher must not pass vacuously', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toMatch(/explore → spec → plan → execute → review → reflect/);
  });
});

/**
 * `.env.example` must not ship a value that OVERRIDES a default.
 *
 * The file exists to be copied to `.env`, so every non-blank entry is a decision made on
 * the operator's behalf. `FORGE_TRUST_PROXY=0` was one: blank derives from `NODE_ENV`, so a
 * production image trusts its proxy — and the shipped `0` turned that off, in exactly the
 * deployment DEPLOYMENT.md tells you to front with a reverse proxy. The result was no
 * per-IP login throttle on a correctly-followed setup.
 *
 * Blank is the file's convention for "use the default". A preset must be justified here.
 */
describe('.env.example presets', () => {
  /** Each non-blank entry, with why it is allowed to carry a value. */
  const PRESET_REASONS: Record<string, string> = {
    // Required, and useless blank — an operator needs a shape to edit, and this one
    // matches the optional `postgres` compose profile so the quick start works as written.
    DATABASE_URL: 'required; the value is a working example matching the compose profile',
    // A seed default, not an override: the bootstrap falls back to `claude` anyway, so
    // stating it documents the protocol vocabulary at the point of use.
    PROVIDER: 'seed default identical to the container bootstrap fallback',
    // Identical to the code default (`!== 'true'`), and the false case is the one worth
    // showing because the true case needs a second process to be running.
    FORGE_DISABLE_LOOP_SCHEDULER: 'matches the code default; documents the two-process case',
  };

  const lines = () =>
    readFileSync(join(process.cwd(), '.env.example'), 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l));

  it('found the variables', () => {
    expect(lines().length).toBeGreaterThan(30);
  });

  it('every preset value is justified', () => {
    const unjustified = lines()
      .filter((l) => l.split('=').slice(1).join('=').trim() !== '')
      .map((l) => l.split('=')[0]!)
      .filter((k) => !(k in PRESET_REASONS));
    expect(
      unjustified,
      'a non-blank .env.example entry decides for the operator — leave it blank, or add it to PRESET_REASONS with why',
    ).toEqual([]);
  });

  it('has no stale justification for a variable that is now blank', () => {
    const nonBlank = new Set(
      lines().filter((l) => l.split('=').slice(1).join('=').trim() !== '').map((l) => l.split('=')[0]!),
    );
    expect(Object.keys(PRESET_REASONS).filter((k) => !nonBlank.has(k))).toEqual([]);
  });

  /** The specific regression: blank means "derive from NODE_ENV". */
  it('leaves the proxy-trust decision to NODE_ENV', () => {
    const line = lines().find((l) => l.startsWith('FORGE_TRUST_PROXY='));
    expect(line, 'FORGE_TRUST_PROXY vanished from .env.example').toBeTruthy();
    expect(line, 'a preset here silently disables the per-IP login throttle in production')
      .toBe('FORGE_TRUST_PROXY=');
  });
});
