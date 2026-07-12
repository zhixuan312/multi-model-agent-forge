import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { loop, loopEventDelivery } from '@/db/schema/loop';
import { verifyEventToken } from '@/loops/event-token';
import { startLoopRun } from '@/loops/run-now';

const eventBodySchema = z.object({
  goal: z.string().trim().min(1),
  reference: z.string().trim().min(1).nullable().optional().transform((v) => v ?? null),
  context: z.string().trim().min(1).nullable().optional().transform((v) => v ?? null),
});

export type AcceptLoopEventResult =
  | { kind: 'accepted'; runId: string }
  | { kind: 'invalid_request' }
  | { kind: 'unauthorized' }
  | { kind: 'wrong_mode' }
  | { kind: 'not_found' }
  | { kind: 'internal_error' };

export interface AcceptLoopEventDeps {
  db?: Db;
  starter?: typeof startLoopRun;
  randomId?: () => string;
}

export async function acceptLoopEvent(args: {
  loopId: string;
  authorization: string | null | undefined;
  idempotencyKey: string | null | undefined;
  body: unknown;
  deps?: AcceptLoopEventDeps;
}): Promise<AcceptLoopEventResult> {
  const db = args.deps?.db ?? getDb();
  const parsed = eventBodySchema.safeParse(args.body);
  const idempotencyKey = args.idempotencyKey?.trim() ?? '';
  if (!parsed.success || !idempotencyKey) return { kind: 'invalid_request' };

  const auth = args.authorization?.trim() ?? '';
  if (!auth.startsWith('Bearer ')) return { kind: 'unauthorized' };
  const candidate = auth.slice('Bearer '.length).trim();
  if (!candidate) return { kind: 'unauthorized' };

  const [loopRow] = await db.select().from(loop).where(eq(loop.id, args.loopId)).limit(1);
  if (!loopRow) return { kind: 'not_found' };
  if (loopRow.mode !== 'event') return { kind: 'wrong_mode' };
  if (!verifyEventToken(candidate, loopRow.eventTokenHash)) return { kind: 'unauthorized' };

  const runId = args.deps?.randomId?.() ?? randomUUID();
  const starter = args.deps?.starter ?? startLoopRun;
  const body = parsed.data;

  const inserted = await db
    .insert(loopEventDelivery)
    .values({
      teamId: loopRow.teamId,
      loopId: loopRow.id,
      idempotencyKey,
      runId,
      reference: body.reference ?? null,
    })
    .onConflictDoNothing()
    .returning({ runId: loopEventDelivery.runId });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({ runId: loopEventDelivery.runId })
      .from(loopEventDelivery)
      .where(and(eq(loopEventDelivery.loopId, loopRow.id), eq(loopEventDelivery.idempotencyKey, idempotencyKey)))
      .limit(1);
    return existing ? { kind: 'accepted', runId: existing.runId } : { kind: 'internal_error' };
  }

  try {
    const started = await starter(loopRow.id, 'event', {
      db,
      runId,
      goalOverride: body.goal,
      idempotencyKey,
      reference: body.reference ?? null,
      context: body.context ?? null,
    });
    if (started.kind !== 'started') throw new Error('loop_not_started');
    return { kind: 'accepted', runId };
  } catch {
    await db
      .delete(loopEventDelivery)
      .where(and(eq(loopEventDelivery.loopId, loopRow.id), eq(loopEventDelivery.idempotencyKey, idempotencyKey)));
    return { kind: 'internal_error' };
  }
}
