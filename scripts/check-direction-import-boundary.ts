/**
 * Guide route-scope gate — `pnpm exec tsx scripts/check-direction-import-boundary.ts`.
 *
 * The Guide manual is a large static document. It must download only on
 * `/settings/guide`. Next.js splits client bundles per route from the STATIC
 * IMPORT GRAPH, so "no other route imports it" is exactly the property that keeps
 * it off every other route's payload — and unlike a build-manifest scan it is
 * stable across Next versions (Next 16 emits no per-route chunk manifest to parse).
 *
 * The checker is pure static analysis: it scans every `.ts`/`.tsx` under `app/`
 * and `src/` outside the two ALLOWED trees and fails naming any file that imports
 * the direction content or renderers.
 *
 *   Allowed importers: app/(app)/settings/guide/**  (the route)
 *                      src/components/direction/**  (the renderers themselves)
 *
 * The Sidebar's Guide rail is NOT an exception to this: it imports
 * `@/content/guide-nav`, a standalone id/part/title projection that carries none
 * of the manual's prose.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SCAN_DIRS = ['app', 'src'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'coverage', '.e2e']);

/** Trees that legitimately import the direction modules. */
const ALLOWED_TREES = ['app/(app)/settings/guide/', 'src/components/direction/'];

/** Module specifiers that carry the manual's payload, in any `@/…` or relative form. */
const DIRECTION_SPECIFIERS = [
  'content/direction-sections',
  'content/direction-reference',
  'components/direction/',
];

/** `import … from 'x'`, `export … from 'x'`, `import('x')`, `require('x')`. */
const SPECIFIER_RE = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

export interface BoundaryViolation {
  file: string;
  specifier: string;
}

/**
 * Every `.ts`/`.tsx` under the scan dirs, repo-relative.
 *
 * A MISSING scan dir throws. It used to `continue` under a comment reading "never a silent
 * pass" — which is precisely what it did: with `app/` gone (renamed, moved, mis-rooted),
 * `src/` alone still returns ~380 files, so the `files.length === 0` guard below never
 * fires and the check reports success having scanned none of the routes. `app/` is where a
 * route-level leak lives, so that is the exact half whose absence must not pass quietly.
 */
function collect(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  for (const d of SCAN_DIRS) {
    const dir = join(root, d);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      throw new Error(
        `check-direction-import-boundary: '${d}/' is missing under ${root} — the scan cannot prove the boundary holds for it`,
      );
    }
    walk(dir);
  }
  return out;
}

/** Every out-of-boundary importer of the direction modules, in scan order. */
export function findDirectionBoundaryViolations(
  root: string = process.cwd(),
  /** Pre-collected file list, so a caller that already walked the tree does not walk it twice. */
  preCollected?: string[],
): BoundaryViolation[] {
  const files = preCollected ?? collect(root);
  if (files.length === 0) {
    throw new Error(`check-direction-import-boundary: no source files found under ${root} — the scan could not run`);
  }
  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    if (ALLOWED_TREES.some((tree) => file.startsWith(tree))) continue;
    const source = readFileSync(join(root, file), 'utf8');
    for (const match of source.matchAll(SPECIFIER_RE)) {
      const specifier = match[1];
      if (DIRECTION_SPECIFIERS.some((d) => specifier.includes(d))) {
        violations.push({ file, specifier });
      }
    }
  }
  return violations;
}

/**
 * Throws naming every offending file when the direction modules leak outside the
 * `/settings/guide` route tree; returns the number of scanned files when clean.
 */
export function checkDirectionImportBoundary(root: string = process.cwd()): number {
  // One walk, not two: this used to call `collect` again purely to count the files it had
  // just scanned, doubling a ~480-file traversal on every CI run.
  const files = collect(root);
  const violations = findDirectionBoundaryViolations(root, files);
  if (violations.length > 0) {
    const lines = violations.map((v) => `  → ${v.file} imports '${v.specifier}'`).join('\n');
    throw new Error(
      `Guide content escaped the /settings/guide route tree — ${violations.length} out-of-boundary import(s):\n${lines}\n` +
        `Only ${ALLOWED_TREES.join(' and ')} may import the direction content/renderers.`,
    );
  }
  return files.length;
}

// Direct CLI invocation (`tsx scripts/check-direction-import-boundary.ts`).
if (process.argv[1] && process.argv[1].includes('check-direction-import-boundary')) {
  try {
    const scanned = checkDirectionImportBoundary(process.cwd());
    console.log(`✓ Direction import boundary — no out-of-boundary importers (${scanned} source files scanned).`);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}
