// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
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
      for (const t of v.tabs ?? []) {
        for (const c of t.consumers ?? []) out.push({ path: c.filePath, where: `${label}/${v.id}/${t.id}.consumers[${c.id}]` });
        for (const d of t.deviations ?? []) out.push({ path: d.filePath, where: `${label}/${v.id}/${t.id}.deviations[${d.id}]` });
      }
    }
  }
  return out;
}

describe('governance registry references real files', () => {
  it('every registry filePath exists on disk', () => {
    const missing = registryPaths().filter((p) => !existsSync(at(p.path)));
    expect(missing.map((m) => `${m.where} → ${m.path}`)).toEqual([]);
  });

  it('every variant-meta filePath exists on disk', () => {
    const missing = variantPaths().filter((p) => !existsSync(at(p.path)));
    expect(missing.map((m) => `${m.where} → ${m.path}`)).toEqual([]);
  });

  it('the catalog is non-trivial — a broken accessor must not vacuously pass', () => {
    // Without this, an empty registry (or a rename that silently yields no paths) would
    // make both checks above pass while validating nothing.
    expect(registryPaths().length).toBeGreaterThan(20);
    expect(variantPaths().length).toBeGreaterThan(10);
  });
});
