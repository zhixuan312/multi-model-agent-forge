import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { stage } from '@/db/schema/projects';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const [row] = await getDb()
    .select({ approvers: stage.approvers })
    .from(stage)
    .where(and(eq(stage.projectId, id), eq(stage.kind, 'spec')))
    .limit(1);
  return NextResponse.json({ approvers: (row?.approvers as string[] | null) ?? [] });
}
