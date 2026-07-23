import { NextResponse } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { buildMmaClient } from '@/mma/server-client';

/**
 * MMA health + deep-token check for the Connections badges (Spec 2 §Flow D).
 * `GET` → 200 { health: {status}, token: { reachable, authValid, version, … } }
 *
 * `health` is the unauthenticated `/health` liveness (ok / drift / unreachable).
 * `token` is the deep `/status` (Bearer) check — the SOLE place a wrong MMA
 * bearer surfaces (authValid:false on a 401). The bearer is never returned.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  let client;
  try {
    client = await buildMmaClient();
  } catch (e) {
    // No bearer configured yet → report unreachable rather than 500.
    return NextResponse.json({
      health: { status: 'unreachable' },
      token: { reachable: false, authValid: false, version: null, uptimeMs: null, activeTasks: null },
      note: (e as Error).message,
    });
  }

  const [health, token] = await Promise.all([client.health(), client.status()]);
  return NextResponse.json({
    health,
    token: {
      reachable: token.reachable,
      authValid: token.authValid,
      version: token.version,
      uptimeMs: token.uptimeMs,
      activeTasks: token.activeTasks,
    },
  });
}
