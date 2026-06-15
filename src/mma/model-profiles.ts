/**
 * Model-profiles read (Spec 2 §model-profiles / `lib/mma/model-profiles.ts`).
 *
 * There is NO HTTP endpoint for the catalog — it is the bundled JSON file
 * `dist/model-profiles.json` from the co-located MMA core install. We resolve it
 * from a small set of candidate paths (explicit `MMA_HOME` → homebrew/npm global
 * installs) and flatten the provider-group shape into a flat suggestion list.
 *
 * Graceful fallback: any miss (file absent / unreadable / malformed JSON) yields
 * `{ available:false, profiles:[] }`; the roster combobox then degrades to
 * custom-id-only (it always accepts a typed model id).
 *
 * The flat shape is `{ provider, prefix, tier, bestFor }` — NO `family` field
 * (the source JSON has no `family` key; the group `defaults.family` is ignored).
 * `prefix` is a canonical FAMILY prefix (e.g. `claude-opus`), NOT a deployable
 * model id — the UI must present it as a suggestion, never a closed select.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** One profile entry inside a provider group (only the fields we read). */
export interface ProfileEntry {
  prefix: string;
  tier?: string;
  bestFor?: string;
  [k: string]: unknown;
}

/** A provider group in the source `model-profiles.json` (loosely typed). */
export interface ProfileGroup {
  provider: string;
  naming?: string;
  defaults?: Record<string, unknown>;
  profiles: ProfileEntry[];
}

/** The flat suggestion the roster combobox consumes. NO `family` field. */
export interface FlatProfile {
  provider: string;
  prefix: string;
  tier: string | null;
  bestFor: string | null;
}

export interface ModelProfilesResult {
  /** false ⟺ the catalog was missing/unreadable/malformed (degrade to custom-id). */
  available: boolean;
  profiles: FlatProfile[];
}

/** Pure flatten: groups → flat `{ provider, prefix, tier, bestFor }[]`. */
export function flattenProfiles(groups: ProfileGroup[]): FlatProfile[] {
  return groups.flatMap((g) =>
    (g.profiles ?? []).map((p) => ({
      provider: g.provider,
      prefix: p.prefix,
      tier: p.tier ?? null,
      bestFor: p.bestFor ?? null,
    })),
  );
}

/**
 * The relative path of the bundled catalog inside the MMA core package, tried
 * under each install root.
 */
const CORE_REL = join('dist', 'model-profiles.json');

/**
 * Candidate absolute paths to the bundled catalog, in priority order. An
 * explicit `MMA_HOME` (treated as the MMA install root) wins; then the common
 * homebrew/npm-global install layouts.
 */
export function defaultCandidatePaths(): string[] {
  const candidates: string[] = [];
  const mmaHome = process.env.MMA_HOME?.trim();
  if (mmaHome) {
    candidates.push(join(mmaHome, 'packages', 'core', CORE_REL)); // monorepo checkout
    candidates.push(join(mmaHome, 'node_modules', '@zhixuan92', 'multi-model-agent-core', CORE_REL));
    candidates.push(join(mmaHome, CORE_REL)); // MMA_HOME pointed straight at the core package
  }
  // Common global-install roots (homebrew + npm). The nested copy under the
  // server package is the one a homebrew install actually ships.
  for (const root of ['/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules']) {
    candidates.push(join(root, '@zhixuan92', 'multi-model-agent-core', CORE_REL));
    candidates.push(
      join(root, '@zhixuan92', 'multi-model-agent', 'node_modules', '@zhixuan92', 'multi-model-agent-core', CORE_REL),
    );
  }
  // Last resort: a `.mma` co-located copy under HOME (rare).
  candidates.push(join(homedir(), '.mma', 'model-profiles.json'));
  return candidates;
}

export interface ReadModelProfilesOptions {
  /** Force a single path (tests). When set, candidatePaths is ignored unless this misses. */
  explicitPath?: string;
  /** Override the candidate search list (tests pass [] to disable the fallback search). */
  candidatePaths?: string[];
}

/**
 * Read + flatten the catalog from the first resolvable candidate path. Never
 * throws — a miss returns `{ available:false, profiles:[] }`.
 */
export function readModelProfiles(opts: ReadModelProfilesOptions = {}): ModelProfilesResult {
  const paths: string[] = [];
  if (opts.explicitPath) paths.push(opts.explicitPath);
  paths.push(...(opts.candidatePaths ?? defaultCandidatePaths()));

  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      return { available: true, profiles: flattenProfiles(parsed as ProfileGroup[]) };
    } catch {
      // Malformed JSON / read error — keep trying remaining candidates.
      continue;
    }
  }
  return { available: false, profiles: [] };
}
