import { NextResponse, type NextRequest } from 'next/server';
import { allComponentsApproved } from '@/spec/orchestrator';
import { assembleSpec } from '@/spec/assemble';
import { ensureSpecStage } from '@/spec/spec-core';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getDb } from '@/db/client';
import { USE_MOCK } from '@/mock/config';
import { assembleMock } from '@/mock/domains/projects/spec';

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST …/assemble` — concatenate approved sections → `artifact(kind='spec',
 * version=max+1)` (F29). Blocked (409) until ALL components are approved.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  if (USE_MOCK) {
    const a = assembleMock(id);
    return NextResponse.json({ artifact: { id: `mock-spec-${id}`, version: a.version, body_md: a.body_md } });
  }

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  const stage = await ensureSpecStage(db, id);
  if (!(await allComponentsApproved(db, stage.id))) {
    return NextResponse.json(
      { error: 'All components must be approved before assembling.' },
      { status: 409 },
    );
  }

  const result = await assembleSpec(db, id, stage.id, guard.memberId);
  return NextResponse.json({ artifact: { id: result.id, version: result.version, body_md: result.bodyMd } });
}
