/**
 * Pins core (Spec: journal recall pins). Per-member CRUD over `journal_pin`.
 * DI'd `Db` so routes stay thin and the core is unit-testable on a mock DB.
 *
 * Mutations are OWNER-SCOPED: `removePin`/`refreshPin` match on `(id, member_id)`,
 * so a non-owner id never mutates another member's pin (it returns `not_found`).
 * These functions never touch MMA — a pin caches a recall the client already ran.
 */
import { and, eq, desc } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { journalPin } from '@/db/schema/journal';
import type { PinnedFinding } from '@/journal/recall-content';

export interface PinsDeps {
  db?: Db;
}

/** A pin as exposed to the client (the cached answer + its freshness marker). */
export interface PinView {
  id: string;
  question: string;
  answerMd: string;
  findings: PinnedFinding[];
  citationIds: string[];
  journalLogCount: number;
  answeredAt: Date;
  createdAt: Date;
}

export interface NewPin {
  question: string;
  answerMd: string;
  findings: PinnedFinding[];
  citationIds: string[];
  journalLogCount: number;
}

export interface RefreshPin {
  answerMd: string;
  findings: PinnedFinding[];
  citationIds: string[];
  journalLogCount: number;
}

function toView(row: typeof journalPin.$inferSelect): PinView {
  return {
    id: row.id,
    question: row.question,
    answerMd: row.answerMd,
    findings: row.findings,
    citationIds: row.citationIds,
    journalLogCount: row.journalLogCount,
    answeredAt: row.answeredAt,
    createdAt: row.createdAt,
  };
}

/** A member's pins, newest first (unpaginated — see spec scale note). */
export async function listPins(memberId: string, deps: PinsDeps = {}): Promise<PinView[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select()
    .from(journalPin)
    .where(eq(journalPin.memberId, memberId))
    .orderBy(desc(journalPin.createdAt));
  return rows.map(toView);
}

/** Pin a recall answer for a member; `journalLogCount` is the freshness stamp. */
export async function addPin(memberId: string, input: NewPin, deps: PinsDeps = {}): Promise<PinView> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .insert(journalPin)
    .values({
      memberId,
      question: input.question,
      answerMd: input.answerMd,
      findings: input.findings,
      citationIds: input.citationIds,
      journalLogCount: input.journalLogCount,
    })
    .returning();
  return toView(row);
}

export type RemovePinResult = { kind: 'removed' } | { kind: 'not_found' };

/** Remove a member's own pin (owner-scoped). */
export async function removePin(memberId: string, id: string, deps: PinsDeps = {}): Promise<RemovePinResult> {
  const db = deps.db ?? getDb();
  const rows = await db
    .delete(journalPin)
    .where(and(eq(journalPin.id, id), eq(journalPin.memberId, memberId)))
    .returning({ id: journalPin.id });
  return rows.length > 0 ? { kind: 'removed' } : { kind: 'not_found' };
}

export type RefreshPinResult = { kind: 'refreshed'; pin: PinView } | { kind: 'not_found' };

/** Replace a member's own pin's cached answer + re-stamp the freshness marker. */
export async function refreshPin(
  memberId: string,
  id: string,
  input: RefreshPin,
  deps: PinsDeps = {},
): Promise<RefreshPinResult> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .update(journalPin)
    .set({
      answerMd: input.answerMd,
      findings: input.findings,
      citationIds: input.citationIds,
      journalLogCount: input.journalLogCount,
      answeredAt: new Date(),
    })
    .where(and(eq(journalPin.id, id), eq(journalPin.memberId, memberId)))
    .returning();
  return row ? { kind: 'refreshed', pin: toView(row) } : { kind: 'not_found' };
}
