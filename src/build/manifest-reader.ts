import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManifestSnapshot } from '@/build/command-inference';
import type { RepoContext } from '@/build/executor';

/**
 * Read the on-disk manifest for a repo (package.json, lockfiles, pyproject.toml)
 * and produce a `ManifestSnapshot` for `inferCommands`. Best-effort: missing
 * files are tolerated (the snapshot just omits those fields).
 */
export async function readManifestFromDisk(repo: RepoContext): Promise<ManifestSnapshot> {
  const root = repo.pathOnDisk;
  const [pkgRaw, pyRaw, hasBun, hasPnpm, hasYarn, hasTox] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8').catch(() => null),
    readFile(join(root, 'pyproject.toml'), 'utf8').catch(() => null),
    exists(join(root, 'bun.lockb')),
    exists(join(root, 'pnpm-lock.yaml')),
    exists(join(root, 'yarn.lock')),
    exists(join(root, 'tox.ini')),
  ]);

  let kind = 'node';
  if (pyRaw && !pkgRaw) kind = 'python';
  if (hasBun) kind = 'bun';

  let packageJson: ManifestSnapshot['packageJson'] = null;
  if (pkgRaw) {
    try { packageJson = JSON.parse(pkgRaw) as ManifestSnapshot['packageJson']; }
    catch { packageJson = null; }
  }

  return {
    kind,
    packageJson,
    lockfiles: { bun: hasBun, pnpm: hasPnpm, yarn: hasYarn },
    pyprojectToml: pyRaw,
    hasToxIni: hasTox,
  };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch { return false; }
}
