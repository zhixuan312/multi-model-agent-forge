// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOVERNANCE_REGISTRY, type GovernanceSlotId } from '@/components/governance/registry';
import {
  APP_SHELL_VARIANTS,
  CONTENT_SHELL_VARIANTS,
  LEFT_PANEL_VARIANTS,
  RIGHT_PANEL_VARIANTS,
  STAGE_FLOW_VARIANTS,
} from '@/components/governance/variant-meta';

/**
 * The registry calls itself "a CODE catalog — the single source of truth", and every entry
 * names a real file: the canonical component, each consumer, each known deviation. Nothing
 * checked those paths, so deleting a component left the registry pointing at a file that no
 * longer exists — silent rot that makes the catalog lie about the codebase. Two such stale
 * entries were found by hand during the audit (a deleted `forge/PageHeader.tsx` deviation
 * and two `BuildMonitor.tsx` references). This closes that hole: the catalog now fails the
 * suite the moment it goes stale, instead of quietly drifting.
 *
 * The walk originally skipped ONE shape — `affordances[].canonicalFilePath` — and both
 * entries that later turned out to be stale were affordances: `VerifyResultBox` (moved to
 * patterns/) and `RecordLearningButton.tsx`, which had never existed at all, advertising a
 * `defaultOn` "Record a learning" button the Journal does not have. A catalog checker that
 * skips a shape is exactly as blind as no checker, for that shape.
 */
const ROOT = process.cwd();
const at = (p: string) => join(ROOT, p);

/** Every `filePath` in the registry, labelled by where it came from. */
function registryPaths(): Array<{ path: string; where: string }> {
  const out: Array<{ path: string; where: string }> = [];
  for (const slotId of Object.keys(GOVERNANCE_REGISTRY) as GovernanceSlotId[]) {
    const e = GOVERNANCE_REGISTRY[slotId];
    out.push({ path: e.canonicalFilePath, where: `${slotId}.canonicalFilePath` });
    for (const c of e.consumers) out.push({ path: c.filePath, where: `${slotId}.consumers[${c.id}]` });
    for (const d of e.deviations) out.push({ path: d.filePath, where: `${slotId}.deviations[${d.id}]` });
  }
  return out;
}

/** Variant metadata carries its own consumer/deviation/canonical paths. */
function variantPaths(): Array<{ path: string; where: string }> {
  const out: Array<{ path: string; where: string }> = [];
  const groups = [
    ['appShell', APP_SHELL_VARIANTS],
    ['contentShell', CONTENT_SHELL_VARIANTS],
    ['leftPanel', LEFT_PANEL_VARIANTS],
    ['rightPanel', RIGHT_PANEL_VARIANTS],
    ['stageFlow', STAGE_FLOW_VARIANTS],
  ] as const;
  for (const [label, variants] of groups) {
    for (const v of variants) {
      if (v.canonicalFilePath) out.push({ path: v.canonicalFilePath, where: `${label}/${v.id}.canonicalFilePath` });
      for (const c of v.consumers ?? []) out.push({ path: c.filePath, where: `${label}/${v.id}.consumers[${c.id}]` });
      for (const d of v.deviations ?? []) out.push({ path: d.filePath, where: `${label}/${v.id}.deviations[${d.id}]` });
      // Affordances carry a canonical path of their own, and were the ONE shape this
      // walk skipped — so both stale entries it later turned out to have were affordances.
      for (const a of v.affordances ?? []) out.push({ path: a.canonicalFilePath, where: `${label}/${v.id}.affordances[${a.id}]` });
      for (const t of v.tabs ?? []) {
        for (const c of t.consumers ?? []) out.push({ path: c.filePath, where: `${label}/${v.id}/${t.id}.consumers[${c.id}]` });
        for (const d of t.deviations ?? []) out.push({ path: d.filePath, where: `${label}/${v.id}/${t.id}.deviations[${d.id}]` });
        for (const a of t.affordances ?? []) out.push({ path: a.canonicalFilePath, where: `${label}/${v.id}/${t.id}.affordances[${a.id}]` });
      }
    }
  }
  return out;
}

/**
 * Some canonical components are a LIBRARY, not a file in this repo — an icon affordance's
 * canonical component is `lucide-react`. A repo path always contains a slash, so that is
 * the discriminator; bare specifiers are checked separately below rather than skipped
 * silently, so a typo that happens to lose its slash cannot slip through as "a package".
 */
const isRepoPath = (p: string) => p.includes('/');

describe('governance registry references real files', () => {
  it('every registry filePath exists on disk', () => {
    const missing = registryPaths().filter((p) => isRepoPath(p.path) && !existsSync(at(p.path)));
    expect(missing.map((m) => `${m.where} → ${m.path}`)).toEqual([]);
  });

  it('every variant-meta filePath exists on disk', () => {
    const missing = variantPaths().filter((p) => isRepoPath(p.path) && !existsSync(at(p.path)));
    expect(missing.map((m) => `${m.where} → ${m.path}`)).toEqual([]);
  });

  it('every non-repo reference is a resolvable package, not a mangled path', () => {
    const bare = [...registryPaths(), ...variantPaths()].filter((p) => !isRepoPath(p.path));
    const unresolvable = bare.filter((p) => {
      try {
        require.resolve(p.path, { paths: [ROOT] });
        return false;
      } catch {
        return true;
      }
    });
    expect(unresolvable.map((m) => `${m.where} → ${m.path}`)).toEqual([]);
  });

  it('the catalog is non-trivial — a broken accessor must not vacuously pass', () => {
    // Without this, an empty registry (or a rename that silently yields no paths) would
    // make both checks above pass while validating nothing.
    expect(registryPaths().length).toBeGreaterThan(20);
    expect(variantPaths().length).toBeGreaterThan(10);
  });
});
/**
 * A path that exists is not the same as a path that still holds what the catalog says.
 * Three entries went stale in exactly that way — `search` → "input" in NodesView.tsx and
 * `categoryChips` → "chip row" in NodesView.tsx (both moved to governed components), and
 * the Badge slot's two journal deviations after they became one. The file kept existing,
 * so the existence walk stayed green.
 *
 * Precise, unlike a consumer-side check: only entries whose `canonicalComponent` starts
 * with a PascalCase identifier are examined, and only against a repo file. Prose
 * canonicals ("chip row", "lucide icon") and external packages ("lucide-react") are
 * skipped rather than guessed at.
 */
/**
 * (canonicalComponent, canonicalFilePath) pairs worth checking: a leading PascalCase
 * identifier and a path inside this repo. Prose canonicals and npm packages are skipped.
 */
function canonicalPairs(): Array<{ ident: string; path: string; where: string }> {
  const out: Array<{ ident: string; path: string; where: string }> = [];
  const add = (component: string | undefined, path: string | undefined, where: string) => {
    if (!component || !path) return;
    if (!path.startsWith('src/') && !path.startsWith('app/')) return; // e.g. 'lucide-react'
    // Prose, not an identifier, when a lowercase WORD follows the first capitalised one:
    // "Left panel — pattern family", "Application background — .app-bg". Composites keep
    // working because what follows is punctuation: "Field + Input", "Avatar / AvatarGroup",
    // "StatusDashboard (metrics row…)".
    if (/^[A-Z][A-Za-z0-9_]*\s+[a-z]/.test(component)) return;
    const ident = component.match(/^[A-Z][A-Za-z0-9_]*/)?.[0];
    if (!ident) return; // prose: 'chip row', 'lucide icon', 'input'
    out.push({ ident, path, where });
  };
  for (const slotId of Object.keys(GOVERNANCE_REGISTRY) as GovernanceSlotId[]) {
    const e = GOVERNANCE_REGISTRY[slotId];
    add(e.canonicalComponent, e.canonicalFilePath, `${slotId}.canonical`);
  }
  const groups = [
    ['appShell', APP_SHELL_VARIANTS],
    ['contentShell', CONTENT_SHELL_VARIANTS],
    ['leftPanel', LEFT_PANEL_VARIANTS],
    ['rightPanel', RIGHT_PANEL_VARIANTS],
    ['stageFlow', STAGE_FLOW_VARIANTS],
  ] as const;
  for (const [label, variants] of groups) {
    for (const v of variants) {
      add(v.canonicalComponent, v.canonicalFilePath, `${label}/${v.id}.canonical`);
      for (const a of v.affordances ?? []) {
        add(a.canonicalComponent, a.canonicalFilePath, `${label}/${v.id}.affordances[${a.id}]`);
      }
      for (const t of v.tabs ?? []) {
        for (const a of t.affordances ?? []) {
          add(a.canonicalComponent, a.canonicalFilePath, `${label}/${v.id}/${t.id}.affordances[${a.id}]`);
        }
      }
    }
  }
  return out;
}

describe('canonical components live where the catalog says', () => {
  const pairs = canonicalPairs();

  it('found a non-trivial number of checkable canonical pairs', () => {
    expect(pairs.length).toBeGreaterThan(10);
  });

  it('every named canonical component is defined in the file it points at', () => {
    const missing: string[] = [];
    for (const { ident, path, where } of pairs) {
      const text = readFileSync(at(path), 'utf8');
      const defined =
        new RegExp(`export\\s+(?:const|function|class|interface|type)\\s+${ident}\\b`).test(text) ||
        new RegExp(`export\\s*\\{[^}]*\\b${ident}\\b`).test(text) ||
        new RegExp(`export\\s+const\\s+${ident}\\s*[:=]`).test(text);
      if (!defined) missing.push(`${where}: ${ident} not defined in ${path}`);
    }
    expect(missing, 'point the entry at the file that defines the component').toEqual([]);
  });
});
