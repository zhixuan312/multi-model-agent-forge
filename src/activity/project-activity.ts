import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { projectActivity, type ProjectActivityRow } from '@/db/schema/activity';

export type ActivityKind = 'action' | 'running' | 'done' | 'error';
export type ActivitySource = 'user' | 'mma';

export interface ActivityActor {
  id: string | null;
  name: string;
  tint: string;
}

export interface RecordActivityInput {
  db: Db;
  projectId: string;
  stage: string;
  phase: string;
  label: string;
  kind: ActivityKind;
  actor: ActivityActor;
  source: ActivitySource;
  durationMs?: number;
  eventKey?: string | null;
  createdAt?: Date;
}

export interface ResolveRunningActivityInput {
  db: Db;
  projectId: string;
  eventKey: string;
  status: 'done' | 'error';
  durationMs?: number;
  label?: string;
}

export interface ProjectActivityEvent {
  id: string;
  seq: number;
  stage: string;
  phase: string;
  label: string;
  kind: ActivityKind;
  actorName: string;
  actorTint: string;
  source: ActivitySource;
  durationMs?: number;
  eventKey: string | null;
  createdAt: string;
}

export async function recordActivity(input: RecordActivityInput): Promise<void> {
  const query = input.db.insert(projectActivity).values({
    projectId: input.projectId,
    stage: input.stage,
    phase: input.phase,
    label: input.label,
    kind: input.kind,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorTint: input.actor.tint,
    source: input.source,
    durationMs: input.durationMs ?? null,
    eventKey: input.eventKey ?? null,
    createdAt: input.createdAt ?? new Date(),
  });

  if (input.eventKey) {
    // The idempotency index is PARTIAL (UNIQUE ... WHERE event_key IS NOT NULL),
    // so the ON CONFLICT arbiter must carry the same predicate or Postgres rejects
    // it with 42P10 (no matching unique/exclusion constraint).
    await query.onConflictDoNothing({
      target: [projectActivity.projectId, projectActivity.eventKey],
      where: isNotNull(projectActivity.eventKey),
    });
    return;
  }

  await query;
}

// Resolves a RUNNING row in place to its terminal state. Returns the number of rows
// updated so the sole caller (appendBatchTerminalEvent) can decide whether the narrow
// tracked-batch fallback insert is needed (FR-6: running + terminal are one logical row).
export async function resolveRunningActivity(input: ResolveRunningActivityInput): Promise<number> {
  const updated = await input.db
    .update(projectActivity)
    .set({
      kind: input.status,
      durationMs: input.durationMs ?? null,
      ...(input.label ? { label: input.label } : {}),
    })
    .where(and(
      eq(projectActivity.projectId, input.projectId),
      eq(projectActivity.eventKey, input.eventKey),
      eq(projectActivity.kind, 'running'),
    ))
    .returning({ id: projectActivity.id });
  return updated.length;
}

export function mapActivityRowToEvent(row: ProjectActivityRow): ProjectActivityEvent {
  return {
    id: row.id,
    seq: row.seq,
    stage: row.stage,
    phase: row.phase,
    label: row.label,
    kind: row.kind,
    actorName: row.actorName,
    actorTint: row.actorTint,
    source: row.source,
    durationMs: row.durationMs ?? undefined,
    eventKey: row.eventKey ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
