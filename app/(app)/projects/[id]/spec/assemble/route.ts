import { NextResponse, type NextRequest } from 'next/server';
import { getLatestSpec } from '@/spec/assemble';
import { guardSpecWrite } from '@/spec/handler-guard';

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST …/assemble` — returns the current spec.md content. Spec.md is the
 * source of truth (created by auto-draft, updated by refine/audit-apply).
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const spec = await getLatestSpec(null, id);
  if (!spec) {
    return NextResponse.json({ error: 'No spec.md found.' }, { status: 404 });
  }

  return NextResponse.json({ artifact: { id, version: spec.version, body_md: spec.bodyMd } });
}
