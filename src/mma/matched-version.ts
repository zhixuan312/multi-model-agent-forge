import pkg from '../../package.json';

/**
 * The MMA engine version THIS Forge build is designed, built, and tested against —
 * an APPLICATION-LEVEL fact (a property of the Forge build, not any tenant or user).
 *
 * Forge talks to the MMA engine over HTTP and assumes a specific engine contract
 * (the /task API shape, skills surface, provider config, wire schema). It is NOT a
 * code dependency — hence a plain package.json field rather than a `dependencies`
 * pin. When the running engine is upgraded past this version, Forge may need to
 * adapt. Workflow: read the MMA CHANGELOG for the delta between MATCHED_MMA_VERSION
 * and the new engine version, adapt Forge, then bump the ONE field in package.json.
 *
 * The exact contract Forge speaks, the capabilities it uses, and the ones it
 * deliberately skips are recorded in src/mma/COMPATIBILITY.md — the evidence
 * behind this version. Keep that matrix in lockstep when bumping the field.
 *
 * Read from `package.json#matchedMmaVersion` (single source of truth) so the value
 * lives with the app manifest and can't drift from a duplicated constant.
 */
export const MATCHED_MMA_VERSION: string =
  (pkg as { matchedMmaVersion?: string }).matchedMmaVersion ?? '0.0.0';

/** Where to review what changed between the matched version and a newer engine. */
export const MMA_CHANGELOG_URL = 'https://github.com/zhixuan312/multi-model-agent/blob/master/CHANGELOG.md';

export type MmaVersionMatch = 'matched' | 'engine-ahead' | 'engine-behind' | 'unknown';

export interface MmaVersionStatus {
  /** The version Forge is built against (package.json#matchedMmaVersion). */
  matched: string;
  /** The live running engine version (from /status), or null if unreachable. */
  live: string | null;
  status: MmaVersionMatch;
}

/** Parse a leading `x.y.z` (tolerates a `v` prefix + trailing pre-release/build). */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1 / 0 / 1 comparing a vs b by major.minor.patch; null if either is unparseable. */
function cmpSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Compare the live engine version to MATCHED_MMA_VERSION.
 *   - `matched`       — engine == matched (Forge is aligned)
 *   - `engine-ahead`  — engine  > matched (engine upgraded; review changelog + update Forge)
 *   - `engine-behind` — engine  < matched (engine older than Forge expects)
 *   - `unknown`       — engine unreachable or an unparseable version string
 */
export function compareMmaVersion(live: string | null): MmaVersionStatus {
  const matched = MATCHED_MMA_VERSION;
  if (!live) return { matched, live: null, status: 'unknown' };
  const c = cmpSemver(live, matched);
  if (c === null) return { matched, live, status: 'unknown' };
  return { matched, live, status: c > 0 ? 'engine-ahead' : c < 0 ? 'engine-behind' : 'matched' };
}
