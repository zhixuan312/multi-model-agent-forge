import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardJournal } from '@/journal/guard';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { listPins, addPin } from '@/journal/pins-core';
import { currentJournalLogCount, isPinStale } from '@/journal/journal-rev';
import { pinFindingsSchema } from '@/journal/pin-payload';

/**
 * Recall pins for the calling member (Spec: journal recall pins). Individual:
 * every operation is scoped to `guard.memberId`. These handlers never dispatch to
 * MMA — a pin caches a recall the client already ran; `POST` only persists it.
 *
 * `GET`  → the caller's pins, each with a server-computed `stale` flag
 *          (journal_log_count vs the journal's current log-entry count).
 * `POST { question, answerMd, citationIds? }` → 201 the created pin (stamps the
 *          current log count as the freshness marker). Same-origin enforced.
 */
export const runtime = 'nodejs';

const addSchema = z.object({
  question: z.string().trim().min(1),
  answerMd: z.string().min(1),
  findings: pinFindingsSchema,
  citationIds: z.array(z.string()).optional().transform((c) => c ?? []),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: false });
  if (guard instanceof NextResponse) return guard;
  const pins = await listPins(guard.memberId);
  const current = await currentJournalLogCount(resolveWorkspaceRoot());
  return NextResponse.json(pins.map((p) => ({ ...p, stale: isPinStale(p.journalLogCount, current) })));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: true });
  if (guard instanceof NextResponse) return guard;
  const json = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid pin.' }, { status: 400 });
  const journalLogCount = await currentJournalLogCount(resolveWorkspaceRoot());
  const pin = await addPin(guard.memberId, { ...parsed.data, journalLogCount });
  return NextResponse.json({ ...pin, stale: false }, { status: 201 });
}
