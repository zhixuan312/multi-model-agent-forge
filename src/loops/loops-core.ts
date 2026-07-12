import { eq, sql, and, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { loop, type LoopRow } from '@/db/schema/loop';
import { LOOP_KIND, LOOP_MODE, LOOP_WORKER_TIER, type LoopMode } from '@/db/enums';
import { parseLoopConfig } from '@/loops/kind-registry';
import { isValidCron } from '@/loops/cron';
import { hashEventToken, mintEventToken } from '@/loops/event-token';

/**
 * Loops CRUD core (spec §3, §6). Admin-only at the route layer. Validation order
 * for create/update: shape → per-kind config → mode semantics → cron → name uniqueness.
 */
export interface LoopsDeps {
  db?: Db;
  actorId?: string;
  teamId?: string;
}

export const createLoopSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(LOOP_KIND),
  config: z.unknown(),
  workerTier: z.enum(LOOP_WORKER_TIER).optional(),
  mode: z.enum(LOOP_MODE).optional(),
  cron: z.string().trim().min(1).nullable().optional(),
  targetBranch: z.string().trim().min(1).nullable().optional(),
  repoIds: z.array(z.string().uuid()).min(1),
  enabled: z.boolean().optional(),
});

export const updateLoopSchema = createLoopSchema.partial();

type BaseCreateUpdateResult =
  | { kind: 'invalid' }
  | { kind: 'invalid_config' }
  | { kind: 'invalid_cron' }
  | { kind: 'invalid_mode' }
  | { kind: 'duplicate_name' }
  | { kind: 'not_found' };

export type CreateLoopResult =
  | { kind: 'created'; loop: LoopRow; eventToken: string | null }
  | Exclude<BaseCreateUpdateResult, { kind: 'not_found' }>;

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

function deriveMode(mode: LoopMode | undefined, cron: string | null | undefined): LoopMode {
  if (mode) return mode;
  return cron ? 'recurring' : 'manual';
}

function validateMode(mode: LoopMode, cron: string | null | undefined): 'ok' | 'invalid_mode' | 'invalid_cron' {
  if (mode === 'recurring') {
    if (!cron) return 'invalid_mode';
    if (!isValidCron(cron)) return 'invalid_cron';
    return 'ok';
  }
  if (cron) return 'invalid_mode';
  return 'ok';
}

export async function createLoop(input: unknown, deps: LoopsDeps = {}): Promise<CreateLoopResult> {
  const db = deps.db ?? getDb();
  const parsed = createLoopSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const { name, kind, config, workerTier, cron, targetBranch, repoIds, enabled } = parsed.data;
  if (!deps.teamId) return { kind: 'invalid' };

  if (!parseLoopConfig(kind, config).ok) return { kind: 'invalid_config' };
  const mode = deriveMode(parsed.data.mode, cron);
  const modeCheck = validateMode(mode, cron ?? null);
  if (modeCheck === 'invalid_mode') return { kind: 'invalid_mode' };
  if (modeCheck === 'invalid_cron') return { kind: 'invalid_cron' };
  if (await nameTaken(db, name, deps.teamId)) return { kind: 'duplicate_name' };

  let eventToken: string | null = null;
  let eventTokenHash: string | null = null;
  if (mode === 'event') {
    eventToken = mintEventToken();
    eventTokenHash = hashEventToken(eventToken);
  }

  const [created] = await db
    .insert(loop)
    .values({
      teamId: deps.teamId,
      name,
      kind,
      config: parseLoopConfig(kind, config).ok ? (config as object) : {},
      workerTier: workerTier ?? 'complex',
      mode,
      cron: mode === 'recurring' ? (cron ?? null) : null,
      targetBranch: targetBranch ?? null,
      repoIds,
      eventTokenHash,
      enabled: enabled ?? true,
      createdBy: deps.actorId ?? null,
    })
    .returning();
  return { kind: 'created', loop: created, eventToken };
}

export type UpdateLoopResult =
  | { kind: 'updated'; loop: LoopRow; eventToken: string | null }
  | BaseCreateUpdateResult;

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
  if (d.name !== undefined && (await nameTaken(db, d.name, deps.teamId, id))) return { kind: 'duplicate_name' };

  const nextMode = deriveMode(d.mode, d.cron !== undefined ? d.cron : existing.cron);
  const nextCron = d.cron !== undefined ? d.cron : existing.cron;
  const modeCheck = validateMode(nextMode, nextCron);
  if (modeCheck === 'invalid_mode') return { kind: 'invalid_mode' };
  if (modeCheck === 'invalid_cron') return { kind: 'invalid_cron' };

  let eventToken: string | null = null;
  let eventTokenHash = existing.eventTokenHash;
  if (existing.mode !== 'event' && nextMode === 'event') {
    eventToken = mintEventToken();
    eventTokenHash = hashEventToken(eventToken);
  } else if (nextMode !== 'event') {
    eventTokenHash = null;
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    mode: nextMode,
    cron: nextMode === 'recurring' ? nextCron : null,
    eventTokenHash,
  };
  if (d.name !== undefined) patch.name = d.name;
  if (d.kind !== undefined) patch.kind = d.kind;
  if (d.config !== undefined) patch.config = d.config;
  if (d.workerTier !== undefined) patch.workerTier = d.workerTier;
  if (d.targetBranch !== undefined) patch.targetBranch = d.targetBranch;
  if (d.repoIds !== undefined) patch.repoIds = d.repoIds;
  if (d.enabled !== undefined) patch.enabled = d.enabled;

  const [updated] = await db.update(loop).set(patch).where(eq(loop.id, id)).returning();
  return { kind: 'updated', loop: updated, eventToken };
}

export type RotateLoopEventTokenResult =
  | { kind: 'rotated'; loop: LoopRow; eventToken: string }
  | { kind: 'not_found' }
  | { kind: 'wrong_mode' };

export async function rotateLoopEventToken(id: string, deps: LoopsDeps = {}): Promise<RotateLoopEventTokenResult> {
  const db = deps.db ?? getDb();
  const where = deps.teamId ? and(eq(loop.id, id), eq(loop.teamId, deps.teamId)) : eq(loop.id, id);
  const [existing] = await db.select().from(loop).where(where).limit(1);
  if (!existing) return { kind: 'not_found' };
  if (existing.mode !== 'event') return { kind: 'wrong_mode' };

  const eventToken = mintEventToken();
  const [updated] = await db
    .update(loop)
    .set({ eventTokenHash: hashEventToken(eventToken), updatedAt: new Date() })
    .where(eq(loop.id, id))
    .returning();
  return { kind: 'rotated', loop: updated, eventToken };
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
