import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  checkConformance,
  summarizeConformance,
  CONFORMANCE_RULES,
  type ConformanceViolation,
  type GovernanceSlotId,
  type LayerConformance,
  type SourceFile,
} from '@/governance/conformance';

/**
 * Server-only runner (node:fs) that feeds the real repo's source into the pure conformance
 * checker. Kept apart from the pure module so `conformance.ts` stays fs-free and unit-testable.
 */

const SCAN_DIRS = ['app', 'src'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'coverage', '.e2e']);

/** Collect every non-test `.ts(x)` source file under app/ + src/ as repo-relative POSIX paths. */
export function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        files.push({ path: relative(root, full).split(sep).join('/'), content: readFileSync(full, 'utf8') });
      }
    }
  };
  for (const d of SCAN_DIRS) {
    const dir = join(root, d);
    try {
      if (statSync(dir).isDirectory()) walk(dir);
    } catch {
      // Directory absent (e.g. a production build with no source) — skip gracefully.
    }
  }
  return files;
}

/** All conformance violations across the repo, in registry-rule order. */
export function runConformanceCheck(root: string = process.cwd()): ConformanceViolation[] {
  return checkConformance(collectSourceFiles(root), CONFORMANCE_RULES);
}

/** Violations for a single governed layer (used per-slot on the govern page). */
export function conformanceForSlot(slotId: GovernanceSlotId, root: string = process.cwd()): ConformanceViolation[] {
  return runConformanceCheck(root).filter((v) => v.slotId === slotId);
}

/**
 * The conformance summary for one slot's layer, or `undefined` when that slot has no
 * automated rule. Resilient: a failed scan (e.g. a production build with no source) yields
 * `undefined` so the govern page simply omits the conformance card rather than erroring.
 */
export function summarizeForSlot(slotId: GovernanceSlotId, root: string = process.cwd()): LayerConformance | undefined {
  if (!CONFORMANCE_RULES.some((r) => r.slotId === slotId)) return undefined;
  try {
    return summarizeConformance(collectSourceFiles(root)).find((s) => s.slotId === slotId);
  } catch {
    return undefined;
  }
}
