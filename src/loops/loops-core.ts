import { eq, sql, and, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { loop, type LoopRow } from '@/db/schema/loop';
import { LOOP_KIND, LOOP_WORKER_TIER } from '@/db/enums';
import { parseLoopConfig } from '@/loops/kind-registry';
import { isValidCron } from '@/loops/cron';

/**
 * Loops CRUD core (spec §3, §6). Admin-only at the route layer. Validation order
 * for create/update: shape → per-kind config → cron → name uniqueness. A loop
 * targets ≥1 workspace repo (`repoIds`); GitHub-only enforcement happens at run
 * time (run-engine step 0) since the repo table carries no remote signal.
 */
export interface LoopsDeps {
  db?: Db;
  actorId?: string; // the admin creating/owning the loop
  teamId?: string; // the team that owns the loop
}

export const createLoopSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(LOOP_KIND),
  config: z.unknown(),
  workerTier: z.enum(LOOP_WORKER_TIER).optional(),
  cron: z.string().trim().min(1).nullable().optional(), // omitted/null = one-time (adhoc)
  targetBranch: z.string().trim().min(1).nullable().optional(), // null = repo default branch
  repoIds: z.array(z.string().uuid()).min(1),
  enabled: z.boolean().optional(),
});

export const updateLoopSchema = createLoopSchema.partial();

export type CreateLoopResult =
  | { kind: 'created'; loop: LoopRow }
  | { kind: 'invalid' }
  | { kind: 'invalid_config' }
  | { kind: 'invalid_cron' }
  | { kind: 'duplicate_name' };

async function nameTaken(db: Db, name: string, teamId?: string, exceptId?: string): Promise<boolean> {
  let where = exceptId
    ? and(sql`lower(${loop.name}) = lower(${name})`, ne(loop.id, exceptId))
    : sql`lower(${loop.name}) = lower(${name})`;
  if (teamId) {
    where = exceptId
      ? and(eq(loop.teamId, teamId), sql`lower(${loop.name}) = lower(${name})`, ne(loop.id, exceptId))
      : and(eq(loop.teamId, teamId), sql`lower(${loop.name}) = lower(${name})`);
  }
  const [row] = await db.select({ id: loop.id }).from(loop).where(where).limit(1);
  return !!row;
}

export async function createLoop(input: unknown, deps: LoopsDeps = {}): Promise<CreateLoopResult> {
  const db = deps.db ?? getDb();
  const parsed = createLoopSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const { name, kind, config, workerTier, cron, targetBranch, repoIds, enabled } = parsed.data;
  if (!deps.teamId) return { kind: 'invalid' };

  if (!parseLoopConfig(kind, config).ok) return { kind: 'invalid_config' };
  if (cron && !isValidCron(cron)) return { kind: 'invalid_cron' }; // only validate when scheduled
  if (await nameTaken(db, name, deps.teamId)) return { kind: 'duplicate_name' };

  const [created] = await db
    .insert(loop)
    .values({
      teamId: deps.teamId,
      name,
      kind,
      config: parseLoopConfig(kind, config).ok ? (config as object) : {},
      workerTier: workerTier ?? 'complex',
      cron: cron ?? null,
      targetBranch: targetBranch ?? null,
      repoIds,
      enabled: enabled ?? true,
      createdBy: deps.actorId ?? null,
    })
    .returning();
  return { kind: 'created', loop: created };
}

export type UpdateLoopResult =
  | { kind: 'updated'; loop: LoopRow }
  | { kind: 'invalid' }
  | { kind: 'invalid_config' }
  | { kind: 'invalid_cron' }
  | { kind: 'duplicate_name' }
  | { kind: 'not_found' };

export async function updateLoop(id: string, input: unknown, deps: LoopsDeps = {}): Promise<UpdateLoopResult> {
  const db = deps.db ?? getDb();
  const parsed = updateLoopSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const d = parsed.data;

  const where = deps.teamId ? and(eq(loop.id, id), eq(loop.teamId, deps.teamId)) : eq(loop.id, id);
  const [existing] = await db.select().from(loop).where(where).limit(1);
  if (!existing) return { kind: 'not_found' };

  const kind = d.kind ?? existing.kind;
  if (d.config !== undefined && !parseLoopConfig(kind, d.config).ok) return { kind: 'invalid_config' };
  if (d.cron != null && !isValidCron(d.cron)) return { kind: 'invalid_cron' }; // only validate a non-null cron
  if (d.name !== undefined && (await nameTaken(db, d.name, deps.teamId, id))) return { kind: 'duplicate_name' };

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.name !== undefined) patch.name = d.name;
  if (d.kind !== undefined) patch.kind = d.kind;
  if (d.config !== undefined) patch.config = d.config;
  if (d.workerTier !== undefined) patch.workerTier = d.workerTier;
  if (d.cron !== undefined) patch.cron = d.cron; // may be null → switch to one-time
  if (d.targetBranch !== undefined) patch.targetBranch = d.targetBranch;
  if (d.repoIds !== undefined) patch.repoIds = d.repoIds;
  if (d.enabled !== undefined) patch.enabled = d.enabled;

  const [updated] = await db.update(loop).set(patch).where(eq(loop.id, id)).returning();
  return { kind: 'updated', loop: updated };
}

export async function listLoops(deps: LoopsDeps = {}): Promise<LoopRow[]> {
  const db = deps.db ?? getDb();
  const query = deps.teamId
    ? db.select().from(loop).where(eq(loop.teamId, deps.teamId))
    : db.select().from(loop);
  return query.orderBy(loop.createdAt);
}

export async function getLoop(id: string, deps: LoopsDeps = {}): Promise<LoopRow | null> {
  const db = deps.db ?? getDb();
  const where = deps.teamId ? and(eq(loop.id, id), eq(loop.teamId, deps.teamId)) : eq(loop.id, id);
  const [row] = await db.select().from(loop).where(where).limit(1);
  return row ?? null;
}

export async function deleteLoop(id: string, deps: LoopsDeps = {}): Promise<{ kind: 'deleted' | 'not_found' }> {
  const db = deps.db ?? getDb();
  const where = deps.teamId ? and(eq(loop.id, id), eq(loop.teamId, deps.teamId)) : eq(loop.id, id);
  const deleted = await db.delete(loop).where(where).returning({ id: loop.id });
  return { kind: deleted.length > 0 ? 'deleted' : 'not_found' };
}

export async function setLoopEnabled(
  id: string,
  enabled: boolean,
  deps: LoopsDeps = {},
): Promise<{ kind: 'updated' | 'not_found' }> {
  const db = deps.db ?? getDb();
  const where = deps.teamId ? and(eq(loop.id, id), eq(loop.teamId, deps.teamId)) : eq(loop.id, id);
  const updated = await db
    .update(loop)
    .set({ enabled, updatedAt: new Date() })
    .where(where)
    .returning({ id: loop.id });
  return { kind: updated.length > 0 ? 'updated' : 'not_found' };
}
