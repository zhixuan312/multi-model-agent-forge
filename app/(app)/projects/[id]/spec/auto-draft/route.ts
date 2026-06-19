import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { guardSpecWrite } from '@/spec/handler-guard';
import { AnthropicClient } from '@/anthropic/client';
import { autoDraftAll } from '@/spec/auto-draft';
import { loadOutline } from '@/spec/spec-core';
import { getDb } from '@/db/client';
import { stage } from '@/db/schema/projects';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSpecWrite(req, id);
  if (guard instanceof NextResponse) return guard;

  const anthropic = await AnthropicClient.fromMainTier();
  const result = await autoDraftAll({ anthropic, projectId: id });

  const db = getDb();
  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, id), eq(stage.kind, 'spec')))
    .limit(1);

  const components = specStage ? await loadOutline(db, specStage.id) : [];

  return NextResponse.json({ ...result, components });
}
