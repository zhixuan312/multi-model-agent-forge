import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { advancePhase } from '@/projects/phase-tracker';
import type { StageKind } from '@/db/enums';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const stageKind = body?.stage as StageKind | undefined;
  const phase = body?.phase as string | undefined;
  if (!stageKind || !phase) return NextResponse.json({ error: 'Missing stage or phase' }, { status: 400 });

  await advancePhase(getDb(), id, stageKind, phase);
  return NextResponse.json({ ok: true });
}
