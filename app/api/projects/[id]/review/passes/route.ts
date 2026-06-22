import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { currentMember } from '@/auth/current-member';
import { assertProjectReadable, ProjectAccessError } from '@/projects/projects-core';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/mma';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertProjectReadable(id, { id: me.id });
  } catch (e) {
    if (e instanceof ProjectAccessError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw e;
  }

  const db = getDb();

  // Load review batches (each = one pass)
  const reviewBatches = await db
    .select({ id: mmaBatch.id, result: mmaBatch.result, status: mmaBatch.status, createdAt: mmaBatch.createdAt })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'review'), eq(mmaBatch.handler, 'code-review')))
    .orderBy(mmaBatch.createdAt);

  // Load apply batches to determine which findings were applied per pass
  const applyBatches = await db
    .select({ request: mmaBatch.request, status: mmaBatch.status })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, id), eq(mmaBatch.route, 'delegate'), eq(mmaBatch.handler, 'review-apply'), eq(mmaBatch.status, 'done')))
    .orderBy(mmaBatch.createdAt);

  const passes = reviewBatches.map((b, i) => {
    const passNo = i + 1;
    const env = b.result as Record<string, unknown> | null;
    const output = (env?.output ?? {}) as Record<string, unknown>;
    let summary = output.summary;
    if (typeof summary === 'string') {
      try { summary = JSON.parse(summary.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')); } catch {}
    }
    const summaryObj = (summary && typeof summary === 'object' ? summary : {}) as Record<string, unknown>;
    const findings = Array.isArray(summaryObj.findings) ? summaryObj.findings as Array<Record<string, unknown>> : [];

    // Check which findings were applied by looking at apply batches for this pass
    const appliedForPass = applyBatches
      .filter((ab) => {
        const req = ab.request as Record<string, unknown> | null;
        return req?.passNo === passNo;
      })
      .flatMap((ab) => {
        const req = ab.request as Record<string, unknown> | null;
        return Array.isArray(req?.findingIndices) ? req.findingIndices as number[] : [];
      });

    const severity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      const w = f.weight as string;
      if (w in severity) severity[w as keyof typeof severity]++;
    }

    return {
      passNo,
      status: b.status as 'done' | 'failed',
      findingsCount: findings.length,
      findings: findings.map((f) => ({
        weight: f.weight as string,
        category: (f.category as string) ?? '',
        claim: (f.claim as string) ?? '',
        evidence: (f.evidence as string) ?? '',
        file: (f.file as string) ?? '',
        line: typeof f.line === 'number' ? f.line : 0,
        suggestion: (f.suggestion as string) ?? '',
      })),
      appliedIndices: [...new Set(appliedForPass)],
      severity,
    };
  });

  return NextResponse.json(passes);
}
