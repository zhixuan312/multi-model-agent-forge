import { and, eq, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';

/**
 * G1 — single-driver lease (Spec 2026-07-05). Exactly ONE driver owns a project's
 * auto loop at a time, DB-authoritatively, so the pipeline stays strictly
 * sequential even across a dev-server restart / boot auto-resume (the in-memory
 * `activeDrivers` map is per-process and cannot coordinate those). The lease lives
 * in `details.automation.{driverId,driverHeartbeatAt}` and is updated with direct
 * partial `jsonb_set` writes (atomic in one statement, no optimistic-lock churn).
 * A holder heartbeats each loop; a would-be driver only takes over when the
 * heartbeat is STALE — so a crashed driver's project self-heals.
 */

/** Heartbeat staleness — a lease older than this may be taken over by another driver. */
export const DRIVER_LEASE_STALE_MS = 60_000;

const staleCond = () =>
  sql`(${project.details}->'automation'->>'driverHeartbeatAt')::timestamptz < now() - interval '60 seconds'`;

/**
 * Atomically claim the lease. Returns true iff this `driverId` now holds it — when
 * it was free, already held by this driver, or taken over from a STALE holder.
 * A single UPDATE (the WHERE decides atomically), so two racing drivers can't both
 * win.
 */
export async function acquireDriverLease(db: Db, projectId: string, driverId: string): Promise<boolean> {
  const rows = await db
    .update(project)
    .set({
      details: sql`jsonb_set(jsonb_set(${project.details}, '{automation,driverId}', to_jsonb(${driverId}::text)), '{automation,driverHeartbeatAt}', to_jsonb(now()::text))`,
    })
    .where(and(
      eq(project.id, projectId),
      or(
        sql`${project.details}->'automation'->>'driverId' IS NULL`,
        sql`${project.details}->'automation'->>'driverId' = ${driverId}`,
        sql`(${project.details}->'automation'->>'driverHeartbeatAt') IS NULL`,
        staleCond(),
      ),
    ))
    .returning({ id: project.id });
  return rows.length > 0;
}

/**
 * Refresh the heartbeat. Returns false when this driver NO LONGER holds the lease
 * (another driver took it over after a stale gap) — the caller must stop driving.
 */
export async function heartbeatDriverLease(db: Db, projectId: string, driverId: string): Promise<boolean> {
  const rows = await db
    .update(project)
    .set({
      details: sql`jsonb_set(${project.details}, '{automation,driverHeartbeatAt}', to_jsonb(now()::text))`,
    })
    .where(and(eq(project.id, projectId), sql`${project.details}->'automation'->>'driverId' = ${driverId}`))
    .returning({ id: project.id });
  return rows.length > 0;
}

/** Release the lease iff held by this driver (best-effort; a takeover already cleared it). */
export async function releaseDriverLease(db: Db, projectId: string, driverId: string): Promise<void> {
  await db
    .update(project)
    .set({
      details: sql`(${project.details} #- '{automation,driverId}') #- '{automation,driverHeartbeatAt}'`,
    })
    .where(and(eq(project.id, projectId), sql`${project.details}->'automation'->>'driverId' = ${driverId}`));
}
