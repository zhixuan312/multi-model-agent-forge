import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { confirmComponents } from '@/spec/orchestrator';
import { captureIntent, ensureSpecStage, loadOutline } from '@/spec/spec-core';
import { guardSpecWrite } from '@/spec/handler-guard';
import { COMPONENT_KIND } from '@/db/enums';
import { getDb } from '@/db/client';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  intentMd: z.string().trim().min(1, 'Intent is required.'),
  kinds: z.array(z.enum(COMPONENT_KIND)).min(1, 'Select at least one component.'),
});

/**
 * `POST …/confirm` — outline confirm: capture intent (derive summary) + create the
 * selected components + their sections (additive, F15). Returns the new outline.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body.' }, { status: 400 });
  }

  const db = getDb();
  const stage = await ensureSpecStage(db, id);
  await captureIntent(db, id, parsed.data.intentMd, guard.memberId);
  await confirmComponents(db, stage.id, parsed.data.kinds);
  return NextResponse.json({ components: await loadOutline(db, stage.id) });
}
