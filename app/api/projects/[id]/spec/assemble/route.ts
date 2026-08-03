import { NextResponse, type NextRequest } from 'next/server';
import { getLatestSpec } from '@/spec/assemble';
import { guardProjectWrite } from '@/auth/guard-project-write';

type Ctx = { params: Promise<{ id: string }> };

/**
 * `POST …/assemble` — returns the current spec.md content. Spec.md is the
 * source of truth (created by auto-draft, updated by refine/audit-apply).
 *
 * POST rather than GET because the client sends it as a same-origin-guarded call and the
 * name is historical (this once assembled). It READS: no `requireUnfrozen`.
 *
 * That option was set here, and it answers `409 Spec is locked — read-only.` for any
 * project past the design phase — a lock on a READ. Nothing hits it today only because the
 * one caller is an effect that returns early when `readOnly` is set; add a "show me the
 * spec" button for a locked project and you would be told the spec is read-only instead of
 * being shown it. The membership guard below is the check this route actually needs.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  const guard = await guardProjectWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const spec = await getLatestSpec(id);
  if (!spec) {
    return NextResponse.json({ error: 'No spec.md found.' }, { status: 404 });
  }

  return NextResponse.json({ artifact: { id, version: spec.version, body_md: spec.bodyMd } });
}
