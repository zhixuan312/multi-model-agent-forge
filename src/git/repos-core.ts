/**
 * Repos core (Spec 2 §Workspace / Flow B). Reads/creates `repo` rows and drives
 * the git clone/pull lifecycle via the `WorkspaceService`.
 *
 * Dependency-injected (`Db` + `SecretStore` + `WorkspaceService`) so the route
 * handlers are thin and the core is testable against the live DB with a mocked
 * git runner. The git token is resolved from `settings_connection.git_token_ref`
 * and passed to the service, never returned to callers, never logged.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { team } from '@/db/schema/team';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';
import { WorkspaceService, PathEscapeError, WorkspaceRootError } from '@/git/workspace';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

export interface ReposDeps {
  db?: Db;
  secrets?: SecretStore;
  workspace?: WorkspaceService;
  teamId?: string;
}

/** A repo row as exposed to the client (no secrets — there are none on the row). */
export interface RepoView {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
  tags: string[];
  headSha: string | null;
  status: 'cloned' | 'pulling' | 'error';
  createdAt: Date;
}

function toView(row: typeof repo.$inferSelect): RepoView {
  return {
    id: row.id,
    name: row.name,
    pathOnDisk: row.pathOnDisk,
    defaultBranch: row.defaultBranch,
    tags: row.tags,
    headSha: row.headSha,
    status: row.status,
    createdAt: row.createdAt,
  };
}

const tagsSchema = z
  .array(z.string().trim().min(1))
  .optional()
  .transform((t) => t ?? []);

/**
 * Normalize a repo name to a filesystem-safe snake_case slug: lowercase, every
 * run of non-alphanumeric chars (spaces, punctuation, slashes) → a single `_`,
 * trimmed of leading/trailing `_`. The name doubles as the on-disk clone
 * directory (`path_on_disk`), so it must be a clean physical name — e.g.
 * "Self Service Demo" → "self_service_demo". Also neutralizes path-escapes
 * (`/`, `\`, `..` all collapse to `_`).
 */
export function toRepoSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export const cloneRepoSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    // The name is the on-disk clone directory, so normalize it to a snake_case
    // slug (no spaces / punctuation). A name with no alphanumerics → empty → invalid.
    .transform(toRepoSlug)
    .refine((n) => n.length > 0, {
      message: 'Name must contain at least one letter or number.',
    }),
  url: z.string().trim().min(1),
  tags: tagsSchema,
});
export type CloneRepoInput = z.infer<typeof cloneRepoSchema>;

export type CloneRepoResult =
  | { kind: 'cloned'; repo: RepoView }
  | { kind: 'invalid'; message?: string }
  | { kind: 'duplicate_name' }
  | { kind: 'error'; message: string; repo?: RepoView };

async function resolveSecrets(deps: ReposDeps): Promise<SecretStore> {
  return deps.secrets ?? (await PostgresSecretStore.create({ db: deps.db }));
}

async function resolveWorkspace(deps: ReposDeps): Promise<WorkspaceService> {
  return deps.workspace ?? new WorkspaceService({ workspaceRoot: resolveWorkspaceRoot() });
}

/** Resolve the git token from team.git_token_ref (null when unset). */
async function gitToken(db: Db, secrets: SecretStore, teamId?: string): Promise<string | undefined> {
  if (!teamId) return undefined;
  const [row] = await db.select().from(team).where(eq(team.id, teamId)).limit(1);
  if (!row?.gitTokenRef) return undefined;
  const tok = await secrets.get(row.gitTokenRef);
  return tok ?? undefined;
}

/** List repos for the team (unfiltered by name — the filter runs client-side, Flow E). */
export async function listRepos(deps: ReposDeps = {}): Promise<RepoView[]> {
  const db = deps.db ?? getDb();
  const query = db.select().from(repo);
  if (deps.teamId) query.where(eq(repo.teamId, deps.teamId));
  const rows = await query.orderBy(repo.createdAt);
  return rows.map(toView);
}

/**
 * Add + clone a repo (Flow B): insert the row at status='pulling', clone, then
 * set the resolved path/branch/sha + status='cloned' (or 'error' on failure).
 */
export async function cloneAndRegister(input: unknown, deps: ReposDeps = {}): Promise<CloneRepoResult> {
  const db = deps.db ?? getDb();
  const parsed = cloneRepoSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid', message: parsed.error.issues[0]?.message };
  const { name, url, tags } = parsed.data;

  // Duplicate-name guard (scoped by team when teamId is provided).
  let query = db.select({ id: repo.id }).from(repo).where(eq(repo.name, name));
  if (deps.teamId) query = query.where(eq(repo.teamId, deps.teamId)) as typeof query;
  const [existing] = await query.limit(1);
  if (existing) return { kind: 'duplicate_name' };

  const secrets = await resolveSecrets(deps);
  const workspace = await resolveWorkspace(deps);
  const token = await gitToken(db, secrets, deps.teamId);

  // Insert the row at 'pulling' so the lifecycle is visible; a placeholder
  // path/branch is replaced on success (the row never stays stuck — on failure
  // we set status='error').
  let rowId: string;
  try {
    const values: Record<string, unknown> = { name, pathOnDisk: name, defaultBranch: 'unknown', tags, status: 'pulling' };
    if (deps.teamId) values.teamId = deps.teamId;
    const [row] = await db
      .insert(repo)
      .values(values)
      .returning({ id: repo.id });
    rowId = row.id;
  } catch (e) {
    if (isUniqueViolation(e)) return { kind: 'duplicate_name' };
    throw e;
  }

  try {
    const result = await workspace.cloneRepo({ url, name, token });
    const [updated] = await db
      .update(repo)
      .set({
        pathOnDisk: result.pathOnDisk,
        defaultBranch: result.defaultBranch,
        headSha: result.headSha,
        status: 'cloned',
      })
      .where(eq(repo.id, rowId))
      .returning();
    return { kind: 'cloned', repo: toView(updated) };
  } catch (e) {
    const [errored] = await db.update(repo).set({ status: 'error' }).where(eq(repo.id, rowId)).returning();
    const message =
      e instanceof PathEscapeError
        ? 'The repo name is not allowed (it escapes the workspace).'
        : e instanceof WorkspaceRootError
          ? (e as Error).message
          : (e as Error).message;
    return { kind: 'error', message, repo: errored ? toView(errored) : undefined };
  }
}

export type PullResult =
  | { kind: 'pulled'; repo: RepoView }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string; repo?: RepoView };

/** Re-pull an existing repo (Flow B pull variant). */
export async function pullExisting(id: string, deps: ReposDeps = {}): Promise<PullResult> {
  const db = deps.db ?? getDb();
  let query = db.select().from(repo).where(eq(repo.id, id));
  if (deps.teamId) query = query.where(eq(repo.teamId, deps.teamId)) as typeof query;
  const [row] = await query.limit(1);
  if (!row) return { kind: 'not_found' };

  const secrets = await resolveSecrets(deps);
  const workspace = await resolveWorkspace(deps);
  const token = await gitToken(db, secrets, deps.teamId);

  await db.update(repo).set({ status: 'pulling' }).where(eq(repo.id, id));
  try {
    const result = await workspace.pullRepo({ name: row.name, pathOnDisk: row.pathOnDisk, token });
    const [updated] = await db
      .update(repo)
      .set({ headSha: result.headSha, status: 'cloned' })
      .where(eq(repo.id, id))
      .returning();
    return { kind: 'pulled', repo: toView(updated) };
  } catch (e) {
    const [errored] = await db.update(repo).set({ status: 'error' }).where(eq(repo.id, id)).returning();
    return { kind: 'error', message: (e as Error).message, repo: errored ? toView(errored) : undefined };
  }
}

export type UpdateRepoResult =
  | { kind: 'updated'; repo: RepoView }
  | { kind: 'not_found' }
  | { kind: 'invalid'; message: string };

export const updateRepoSchema = z.object({
  tags: tagsSchema,
  defaultBranch: z.string().trim().min(1).optional(),
});

export async function updateRepo(id: string, input: unknown, deps: ReposDeps = {}): Promise<UpdateRepoResult> {
  const db = deps.db ?? getDb();
  const parsed = updateRepoSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  let query = db.select({ id: repo.id }).from(repo).where(eq(repo.id, id));
  if (deps.teamId) query = query.where(eq(repo.teamId, deps.teamId)) as typeof query;
  const [existing] = await query.limit(1);
  if (!existing) return { kind: 'not_found' };

  const set: Record<string, unknown> = {};
  if (parsed.data.tags !== undefined) set.tags = parsed.data.tags;
  if (parsed.data.defaultBranch) set.defaultBranch = parsed.data.defaultBranch;

  if (Object.keys(set).length === 0) {
    let readQuery = db.select().from(repo).where(eq(repo.id, id));
    if (deps.teamId) readQuery = readQuery.where(eq(repo.teamId, deps.teamId)) as typeof readQuery;
    const [row] = await readQuery.limit(1);
    return { kind: 'updated', repo: toView(row) };
  }

  const [updated] = await db.update(repo).set(set).where(eq(repo.id, id)).returning();
  return { kind: 'updated', repo: toView(updated) };
}

export type DeleteRepoResult = { kind: 'deleted' } | { kind: 'not_found' };

/** Remove a repo row (does not delete files on disk in this slice). */
export async function deleteRepo(id: string, deps: ReposDeps = {}): Promise<DeleteRepoResult> {
  const db = deps.db ?? getDb();
  let query = db.delete(repo).where(eq(repo.id, id));
  if (deps.teamId) query = query.where(eq(repo.teamId, deps.teamId)) as typeof query;
  const rows = await query.returning({ id: repo.id });
  return rows.length > 0 ? { kind: 'deleted' } : { kind: 'not_found' };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Two-way sync between the workspace directory on disk and the
 * `workspace_repo` DB table for the team.
 *
 * - Disk → DB: git repos on disk not in the DB are auto-registered.
 * - DB → Disk: repos in the DB whose path no longer exists are marked `error`.
 *
 * Called on workspace page load so the DB always reflects reality.
 */
export async function syncWorkspaceRepos(deps: ReposDeps = {}): Promise<{ added: string[]; flagged: string[] }> {
  const { readdirSync, existsSync, statSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { join } = await import('node:path');

  const db = deps.db ?? getDb();
  const root = resolveWorkspaceRoot();
  const added: string[] = [];
  const flagged: string[] = [];

  if (!existsSync(root)) return { added, flagged };

  let query = db.select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk, status: repo.status }).from(repo);
  if (deps.teamId) query = query.where(eq(repo.teamId, deps.teamId)) as typeof query;
  const dbRows = await query;
  const dbByName = new Map(dbRows.map((r) => [r.name, r]));

  const entries = readdirSync(root, { withFileTypes: true });
  const diskRepoNames = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const dirPath = join(root, entry.name);
    const gitDir = join(dirPath, '.git');
    if (!existsSync(gitDir)) continue;

    diskRepoNames.add(entry.name);

    if (!dbByName.has(entry.name)) {
      let defaultBranch = 'main';
      let headSha: string | null = null;
      try {
        defaultBranch = execFileSync('git', ['-C', dirPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim() || 'main';
        headSha = execFileSync('git', ['-C', dirPath, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim() || null;
      } catch { /* use defaults */ }

      try {
        const values: Record<string, unknown> = {
          name: entry.name,
          pathOnDisk: dirPath,
          defaultBranch,
          headSha,
          status: 'cloned',
        };
        if (deps.teamId) values.teamId = deps.teamId;
        await db.insert(repo).values(values);
        added.push(entry.name);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }

  for (const row of dbRows) {
    if (row.status === 'error') continue;
    const onDisk = existsSync(row.pathOnDisk) && statSync(row.pathOnDisk).isDirectory();
    if (!onDisk) {
      await db.update(repo).set({ status: 'error' }).where(eq(repo.id, row.id));
      flagged.push(row.name);
    }
  }

  return { added, flagged };
}
