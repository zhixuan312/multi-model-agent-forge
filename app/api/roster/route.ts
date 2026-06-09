import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { listRoster, updateRoster } from '@/config/roster-core';

/**
 * Admin Agent-roster API (Spec 2 §Agent roster).
 * `GET`  → 200 [{ tier, providerId, model, updatedAt }]  (the 3 seeded tiers)
 * `PUT  { tiers: [{ tier, providerId, model }] }`
 *   → 200 the refreshed roster
 *   → 400 invalid (bad tier, half-set tier)
 *   → 409 unknown provider referenced
 *   → 403 non-admin / 401 unauthenticated
 *
 * Part-A: model is free text; the config write to MMA (Save & apply) is Part B.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  return NextResponse.json(await listRoster());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const json = await req.json().catch(() => null);
  const result = await updateRoster(json);

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json(
        { error: result.message ?? 'Invalid roster update.' },
        { status: 400 },
      );
    case 'unknown_provider':
      return NextResponse.json(
        { error: 'A selected provider does not exist.', field: 'providerId' },
        { status: 409 },
      );
    case 'updated':
      return NextResponse.json(result.roster);
  }
}
