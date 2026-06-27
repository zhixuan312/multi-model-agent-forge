import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, sql, gt } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const db = getDb();

  const passNo = req.nextUrl.searchParams.get('passNo');

  const [counts] = await db
    .select({
      total: sql<number>`count(*)`,
      done: sql<number>`count(*) filter (where ${mmaBatch.status} in ('done', 'failed'))`,
    })
    .from(mmaBatch)
    .where(and(
      eq(mmaBatch.projectId, id),
      eq(mmaBatch.handler, 'spec-audit-apply'),
      passNo
        ? sql`${mmaBatch.request}->>'passNo' = ${passNo}`
        : gt(mmaBatch.createdAt, new Date(Date.now() - 30 * 60_000)),
    ));

  const total = Number(counts?.total ?? 0);
  const done = Number(counts?.done ?? 0);

  return NextResponse.json({ allDone: total > 0 && done >= total, done, total });
}
