import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, sql, gt } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const db = getDb();

  // Only look at recent apply batches (last 30 minutes) to scope to the current run
  const cutoff = new Date(Date.now() - 30 * 60_000);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)`,
      done: sql<number>`count(*) filter (where ${mmaBatch.status} in ('done', 'failed'))`,
    })
    .from(mmaBatch)
    .where(and(
      eq(mmaBatch.projectId, id),
      eq(mmaBatch.handler, 'spec-audit-apply'),
      gt(mmaBatch.createdAt, cutoff),
    ));

  const total = Number(counts?.total ?? 0);
  const done = Number(counts?.done ?? 0);

  return NextResponse.json({ allDone: total > 0 && done >= total, done, total });
}
