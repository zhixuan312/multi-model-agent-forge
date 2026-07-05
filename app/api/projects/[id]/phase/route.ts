import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { advancePhase } from '@/projects/phase-tracker';
import { findInflight } from '@/dispatch/dispatch-helpers';
import type { StageKind } from '@/db/enums';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const stageKind = body?.stage as StageKind | undefined;
  const phase = body?.phase as string | undefined;
  if (!stageKind || !phase) return NextResponse.json({ error: 'Missing stage or phase' }, { status: 400 });

  // G3 — refuse a manual phase advance while any MMA request is in flight (a phase
  // change out from under an in-flight batch corrupts the sequential invariant).
  if (await findInflight(getDb(), id) !== null) {
    return NextResponse.json({ error: 'A task is still running — wait for it to finish before advancing.' }, { status: 409 });
  }

  await advancePhase(getDb(), id, stageKind, phase);
  return NextResponse.json({ ok: true });
}
