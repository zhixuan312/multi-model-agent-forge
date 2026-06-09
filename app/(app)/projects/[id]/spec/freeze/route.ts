import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { freezeProject } from '@/spec/freeze';

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST …/freeze` — the irreversible Design→Build boundary (F20/F26). Any project
 * member may freeze (no owner restriction). Gated on `canFreeze` (latest verdict
 * clean OR audit_override). Note: NOT `requireUnfrozen` — freeze IS the transition
 * out of Design; the core's in-tx guard rejects a double-freeze.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  const result = await freezeProject(id, guard.memberId, { db });
  if (!result.ok) {
    return NextResponse.json(
      { error: 'The audit must be clean (or overridden) before freezing.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, alreadyFrozen: result.alreadyFrozen });
}
