/**
 * One-shot migration: relocate each project's on-disk markdown artifacts from the
 * legacy GLOBAL workspace root (`<globalRoot>/.mma/projects/<id>/`) to its OWNING
 * TEAM's workspace root (`<teamRoot>/.mma/projects/<id>/`) — the convention
 * `resolveProjectArtifactDir` now reads/writes. For the single default team,
 * teamRoot === globalRoot, so every plan is a no-op; the script exists (and is
 * idempotent) for the multi-team future where teams own distinct roots.
 *
 * Idempotent: a re-run finds the source already gone and skips. Data-safe: a
 * pre-existing destination is MERGED, never clobbered — files present in both are
 * left at the source and reported as conflicts for manual resolution.
 *
 * Run with `tsx src/projects/migrate-artifacts-to-team-root.ts` (append `--dry`
 * to preview).
 */
import { join, dirname, basename } from 'node:path';
import { existsSync, mkdirSync, renameSync, readdirSync, rmdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { team } from '@/db/schema/team';
import { resolveWorkspaceRoot, resolveTeamWorkspaceRoot } from '@/git/workspace-root';

export interface ArtifactMigrationPlan {
  projectId: string;
  /** `<globalRoot>/.mma/projects/<id>` */
  from: string;
  /** `<teamRoot>/.mma/projects/<id>` */
  to: string;
  action: 'move' | 'noop';
}

export type MigrationResult = 'moved' | 'merged' | 'noop' | 'skipped-no-source';

export interface ArtifactMigrationReport extends ArtifactMigrationPlan {
  result: MigrationResult;
  /** Filenames present in both source and destination (merge only) — left at source. */
  conflicts?: string[];
  dryRun?: boolean;
}

const artifactDir = (root: string, projectId: string): string =>
  join(root, '.mma', 'projects', projectId);

/** Pure: compute the from/to paths and whether a move is needed. */
export function planProjectArtifactMigration(args: {
  projectId: string;
  globalRoot: string;
  teamRoot: string;
}): ArtifactMigrationPlan {
  const from = artifactDir(args.globalRoot, args.projectId);
  const to = artifactDir(args.teamRoot, args.projectId);
  return { projectId: args.projectId, from, to, action: from === to ? 'noop' : 'move' };
}

/** Execute one plan against the filesystem, honouring dryRun. */
function executePlan(plan: ArtifactMigrationPlan, dryRun: boolean): ArtifactMigrationReport {
  if (plan.action === 'noop') return { ...plan, result: 'noop', ...(dryRun ? { dryRun } : {}) };
  if (!existsSync(plan.from)) return { ...plan, result: 'skipped-no-source', ...(dryRun ? { dryRun } : {}) };

  // A move is warranted. Report the intended outcome without touching disk on dry runs.
  if (dryRun) {
    return { ...plan, result: existsSync(plan.to) ? 'merged' : 'moved', dryRun };
  }

  if (!existsSync(plan.to)) {
    mkdirSync(dirname(plan.to), { recursive: true });
    renameSync(plan.from, plan.to);
    return { ...plan, result: 'moved' };
  }

  // Destination already exists — merge child-by-child, never overwriting.
  const conflicts: string[] = [];
  for (const child of readdirSync(plan.from)) {
    const src = join(plan.from, child);
    const dst = join(plan.to, child);
    if (existsSync(dst)) {
      conflicts.push(basename(child));
      continue; // leave at source for manual resolution
    }
    renameSync(src, dst);
  }
  // Remove the source dir only if it is now empty (no conflicts remained behind).
  if (readdirSync(plan.from).length === 0) rmdirSync(plan.from);
  return { ...plan, result: 'merged', conflicts };
}

export interface MigrateArtifactsDeps {
  db?: Db;
  /** Legacy global root artifacts are moving OUT of. Defaults to `resolveWorkspaceRoot()`. */
  globalRoot?: string;
  dryRun?: boolean;
}

/**
 * Migrate every project's artifacts to its owning team's workspace root. Returns
 * one report per project.
 */
export async function migrateProjectArtifacts(
  deps: MigrateArtifactsDeps = {},
): Promise<ArtifactMigrationReport[]> {
  const db = deps.db ?? getDb();
  const globalRoot = deps.globalRoot ?? resolveWorkspaceRoot();
  const dryRun = deps.dryRun ?? false;

  const rows = await db
    .select({ id: project.id, workspaceRootPath: team.workspaceRootPath })
    .from(project)
    .innerJoin(team, eq(project.teamId, team.id));

  const reports: ArtifactMigrationReport[] = [];
  for (const row of rows) {
    const teamRoot = resolveTeamWorkspaceRoot({ workspaceRootPath: row.workspaceRootPath });
    const plan = planProjectArtifactMigration({ projectId: row.id, globalRoot, teamRoot });
    reports.push(executePlan(plan, dryRun));
  }
  return reports;
}

// CLI entry: `tsx src/projects/migrate-artifacts-to-team-root.ts [--dry]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry');
  import('dotenv/config')
    .then(() => migrateProjectArtifacts({ dryRun }))
    .then((reports) => {
      for (const r of reports) {
        const extra = r.conflicts?.length ? ` conflicts=[${r.conflicts.join(', ')}]` : '';
         
        console.log(`${r.result.padEnd(18)} ${r.projectId}  ${r.from} -> ${r.to}${extra}`);
      }
      const moved = reports.filter((r) => r.result === 'moved' || r.result === 'merged').length;
       
      console.log(`\n${dryRun ? '[dry-run] ' : ''}${reports.length} project(s), ${moved} relocated.`);
      process.exit(0);
    })
    .catch((err) => {
       
      console.error(err);
      process.exit(1);
    });
}
