import { NextResponse, type NextRequest } from 'next/server';
import { guardProjectRead } from '@/auth/guard-project-write';
import { latestExplorationArtifact } from '@/exploration/explore-core';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const gate = await guardProjectRead(id);
  if (gate instanceof Response) return gate;
  const a = await latestExplorationArtifact(id);
  if (!a) return NextResponse.json(null);
  return NextResponse.json(a);
}
