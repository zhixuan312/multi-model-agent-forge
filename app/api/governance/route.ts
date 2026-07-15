import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import {
  getComponentGovernanceView,
  updateComponentGovernance,
} from '@/config/component-governance-core';

export async function GET(): Promise<NextResponse> {
  const actor = await currentMember();
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getComponentGovernanceView());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await currentMember();
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const result = await updateComponentGovernance(body);
  if (result.kind === 'invalid') {
    return NextResponse.json({ error: 'Invalid governance fields.' }, { status: 400 });
  }

  return NextResponse.json(result.governance);
}
