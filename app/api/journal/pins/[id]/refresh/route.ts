import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardJournal } from '@/journal/guard';
import { resolveTeamWorkspaceRoot } from '@/git/workspace-root';
import { refreshPin } from '@/journal/pins-core';
import { currentJournalLogCount } from '@/journal/journal-rev';
import { pinFindingsSchema } from '@/journal/pin-payload';

/**
 * `POST /api/journal/pins/[id]/refresh { answerMd, citationIds? }` — replace a
 * pin's cached answer + re-stamp its freshness marker (owner-scoped, same-origin).
 *
 * The client re-runs the recall through the EXISTING recall dispatch+poll flow and
 * submits the terminal result here; this route does NOT dispatch to MMA. A failed
 * recall is surfaced by the existing recall UI and simply means this is never
 * called — the prior cached pin stays intact. 200 (owner) · 404 · 400 (bad body).
 */
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const refreshSchema = z.object({
  answerMd: z.string().min(1),
  findings: pinFindingsSchema,
  citationIds: z.array(z.string()).optional().transform((c) => c ?? []),
});

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const guard = await guardJournal(req, { checkCsrf: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = refreshSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid refresh.' }, { status: 400 });
  const journalLogCount = await currentJournalLogCount(resolveTeamWorkspaceRoot(guard.team));
  const result = await refreshPin(guard.memberId, id, { ...parsed.data, journalLogCount });
  if (result.kind === 'not_found') return NextResponse.json({ error: 'Pin not found.' }, { status: 404 });
  return NextResponse.json({ ...result.pin, stale: false });
}
