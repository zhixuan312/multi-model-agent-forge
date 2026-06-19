import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { guardSpecWrite } from '@/spec/handler-guard';
import { getLatestSpec } from '@/spec/assemble';
import {
  runAuditPass,
  auditPassHistory,
  AuditIncompleteError,
} from '@/spec/audit-loop';
import { canFreeze } from '@/spec/freeze';
import { buildMmaClient } from '@/mma/server-client';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** Reuse a prior pass's registered context block to avoid re-uploading the spec. */
  contextBlockIds: z.array(z.string()).optional(),
});

/**
 * `POST …/spec/audit` — run ONE `audit(subtype='spec')` pass against the latest
 * assembled spec, at `cwd`=workspace root (F27). Persists an `audit_pass` row and
 * returns the updated pass history + the freeze gate. NEVER auto-edits the spec —
 * the user revises + re-assembles + re-audits.
 *
 * A missing/incomplete or hung dispatch (F20/F15) → retryable, NO pass row, freeze
 * stays gated.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;

  const guard = await guardSpecWrite(req, id, { requireUnfrozen: true });
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const db = getDb();
  const spec = await getLatestSpec(db, id);
  if (!spec) {
    return NextResponse.json(
      { error: 'Assemble the specification before auditing.' },
      { status: 409 },
    );
  }

  try {
    const mma = await buildMmaClient({ db });
    const result = await runAuditPass(
      { db, mma },
      { projectId: id, specMd: spec.bodyMd, actorId: guard.memberId, contextBlockIds: parsed.data.contextBlockIds },
    );
    return NextResponse.json({
      pass: {
        passNo: result.passNo,
        verdict: result.verdict,
        findingsCount: result.findingsCount,
        findings: result.findings,
      },
      contextBlockId: result.contextBlockId,
      history: await auditPassHistory(db, id),
      canFreeze: await canFreeze(db, id),
    });
  } catch (e) {
    if (e instanceof AuditIncompleteError) {
      return NextResponse.json(
        { error: 'The audit did not finish — try again.', headline: e.headline, retryable: true },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'The audit could not be completed — try again.', retryable: true },
      { status: 502 },
    );
  }
}
