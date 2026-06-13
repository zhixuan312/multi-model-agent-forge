import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { recordAuditOverride, canFreeze } from '@/spec/freeze';
import { USE_MOCK } from '@/mock/config';
import { auditOverrideMock } from '@/mock/domains/projects/spec';

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST …/spec/audit-override` — the cap-reached escape hatch (F26). Records an
 * `audit_override` action_log row so Freeze is enabled despite a standing
 * `revised` verdict. Any project member; project must still be in Design.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  if (USE_MOCK) return NextResponse.json(auditOverrideMock(id));

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const db = getDb();
  await recordAuditOverride(id, guard.memberId, { db });
  return NextResponse.json({ canFreeze: await canFreeze(db, id) });
}
