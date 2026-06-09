import { NextResponse } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { readModelProfiles } from '@/mma/model-profiles';

/**
 * Model-profiles catalog for the roster combobox (Spec 2 §model-profiles / Flow C).
 * `GET` → 200 { available, profiles: [{ provider, prefix, tier, bestFor }] }
 *
 * Reads the co-located MMA core's bundled `model-profiles.json`. On any miss
 * (absent/unreadable/malformed) it returns `{ available:false, profiles:[] }` so
 * the combobox degrades to custom-id-only (it always accepts a typed model id).
 */
export async function GET(): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;
  return NextResponse.json(readModelProfiles());
}
