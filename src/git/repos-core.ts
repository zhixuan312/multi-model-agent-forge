/**
 * Repos core (Spec 2 §Workspace / Flow B). Reads/creates `repo` rows and drives
 * the git clone/pull lifecycle via the `WorkspaceService`.
 *
 * Dependency-injected (`Db` + `SecretStore` + `WorkspaceService`) so the route
 * handlers are thin and the core is testable against the live DB with a mocked
 * git runner. The git token is resolved from `team_settings.git_token_ref` and
 * passed to the service, never returned to callers, never logged.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { repo } from '@/db/schema/workspace';
import { teamSettings } from '@/db/schema/config';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';
import { WorkspaceService, PathEscapeError, WorkspaceRootError } from '@/git/workspace';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

export interface ReposDeps {
  db?: Db;
  secrets?: SecretStore;
  workspace?: WorkspaceService;
}

/** A repo row as exposed to the client (no secrets — there are none on the row). */
export interface RepoView {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
  kind: string;
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
    kind: row.kind,
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

export const cloneRepoSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    // Reject path-escaping names up front (the service sandbox is the real guard).
    .refine((n) => !n.includes('/') && !n.includes('\\') && n !== '.' && n !== '..', {
      message: 'Name must be a simple directory name (no slashes or "..").',
    }),
  url: z.string().trim().min(1),
  kind: z.string().trim().min(1).default('service'),
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

/** Resolve the git token from team_settings.git_token_ref (null when unset). */
async function gitToken(db: Db, secrets: SecretStore): Promise<string | undefined> {
  const [row] = await db.select().from(teamSettings).limit(1);
  if (!row?.gitTokenRef) return undefined;
  const tok = await secrets.get(row.gitTokenRef);
  return tok ?? undefined;
}

/** List all repos (unfiltered — the filter runs client-side, Flow E). */
export async function listRepos(deps: ReposDeps = {}): Promise<RepoView[]> {
  const db = deps.db ?? getDb();
  const rows = await db.select().from(repo).orderBy(repo.createdAt);
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
  const { name, url, kind, tags } = parsed.data;

  // Duplicate-name guard (the UNIQUE column is the real race guard).
  const [existing] = await db.select({ id: repo.id }).from(repo).where(eq(repo.name, name)).limit(1);
  if (existing) return { kind: 'duplicate_name' };

  const secrets = await resolveSecrets(deps);
  const workspace = await resolveWorkspace(deps);
  const token = await gitToken(db, secrets);

  // Insert the row at 'pulling' so the lifecycle is visible; a placeholder
  // path/branch is replaced on success (the row never stays stuck — on failure
  // we set status='error').
  let rowId: string;
  try {
    const [row] = await db
      .insert(repo)
      .values({ name, pathOnDisk: name, defaultBranch: 'unknown', kind, tags, status: 'pulling' })
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
  const [row] = await db.select().from(repo).where(eq(repo.id, id)).limit(1);
  if (!row) return { kind: 'not_found' };

  const secrets = await resolveSecrets(deps);
  const workspace = await resolveWorkspace(deps);
  const token = await gitToken(db, secrets);

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

export type DeleteRepoResult = { kind: 'deleted' } | { kind: 'not_found' };

/** Remove a repo row (does not delete files on disk in this slice). */
export async function deleteRepo(id: string, deps: ReposDeps = {}): Promise<DeleteRepoResult> {
  const db = deps.db ?? getDb();
  const rows = await db.delete(repo).where(eq(repo.id, id)).returning({ id: repo.id });
  return rows.length > 0 ? { kind: 'deleted' } : { kind: 'not_found' };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
