/**
 * Build/test command inference (Spec 7 §Execute step 3, F17 — the fixed v1
 * mapping). PURE over an injected manifest snapshot — no fs here (the executor
 * reads the manifest files and hands them in), so this is unit-testable without
 * a repo on disk.
 *
 * Node/Bun: read `package.json` scripts. build = `<pm> run build` iff a `build`
 * script exists, else none; test = `<pm> run test` iff a `test` script exists,
 * else none. `<pm>` from the lockfile (bun.lockb→bun, pnpm-lock.yaml→pnpm,
 * yarn.lock→yarn, else npm).
 *
 * Python: sniff `pyproject.toml`/`setup.cfg`. build = `python -m build` iff a
 * `[build-system]` table, else none; test = `pytest` iff pytest is a declared
 * dep or a `[tool.pytest]` table, else `tox` iff `tox.ini`, else none.
 *
 * Absent → null (vacuous pass), never a guess. Tie-break: the conventional
 * script wins; never chain commands.
 */

export interface ManifestSnapshot {
  kind: string; // detected language/ecosystem (node | bun | python), sniffed from manifest files
  /** Parsed package.json (node/bun), or null. */
  packageJson?: { scripts?: Record<string, string> } | null;
  /** Lockfile presence flags. */
  lockfiles?: { bun?: boolean; pnpm?: boolean; yarn?: boolean };
  /** Raw pyproject.toml text (python), or null. */
  pyprojectToml?: string | null;
  /** Whether a tox.ini exists (python). */
  hasToxIni?: boolean;
}

export interface InferredCommands {
  /** The build command as an argv array, or null (vacuous-pass). */
  build: string[] | null;
  /** The test command as an argv array, or null (vacuous-pass). */
  test: string[] | null;
}

function pmFor(locks?: ManifestSnapshot['lockfiles']): string {
  if (locks?.bun) return 'bun';
  if (locks?.pnpm) return 'pnpm';
  if (locks?.yarn) return 'yarn';
  return 'npm';
}

/** A display string for a resolved argv (persisted to meta.buildCmd/testCmd). */
export function cmdToString(argv: string[] | null): string | null {
  return argv ? argv.join(' ') : null;
}

export function inferCommands(m: ManifestSnapshot): InferredCommands {
  const kind = m.kind.toLowerCase();

  if (kind === 'node' || kind === 'bun') {
    const scripts = m.packageJson?.scripts ?? {};
    const pm = pmFor(m.lockfiles);
    const build = 'build' in scripts ? [pm, 'run', 'build'] : null;
    const test = 'test' in scripts ? (pm === 'npm' ? ['npm', 'test'] : [pm, 'run', 'test']) : null;
    return { build, test };
  }

  if (kind === 'python') {
    const toml = m.pyprojectToml ?? '';
    const hasBuildSystem = /\[build-system\]/.test(toml);
    const hasPytestTable = /\[tool\.pytest/.test(toml);
    const declaresPytest = /pytest/.test(toml);
    const build = hasBuildSystem ? ['python', '-m', 'build'] : null;
    let test: string[] | null = null;
    if (declaresPytest || hasPytestTable) test = ['pytest'];
    else if (m.hasToxIni) test = ['tox'];
    return { build, test };
  }

  // Unknown kind → no inferred commands (vacuous pass).
  return { build: null, test: null };
}
