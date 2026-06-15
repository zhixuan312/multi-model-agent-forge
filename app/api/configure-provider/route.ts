import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { buildMmaClient } from '@/mma/server-client';
import type { ConfigureProviderRequest } from '@/mma/configure-provider';

/**
 * Admin proxy for mma's `POST /configure-provider` (Spec: combined Models
 * page). Forge does NOT re-validate — mma owns the validate ladder + the
 * runtime in-memory hot-swap. This route only: admin-gates, shape-checks the
 * body, and relays to the live daemon with the team bearer (kept server-side).
 *
 * Validate = `dryRun:true` (default), Apply = `dryRun:false`. The mma result
 * (verified/reason/applied/probe) is returned verbatim for the page to render.
 */
const authSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('oauth') }),
  z.object({ mode: z.literal('api-key'), apiKey: z.string().min(1), baseUrl: z.string().trim().optional() }),
]);

const requestSchema = z.object({
  tier: z.enum(['main', 'complex', 'standard']),
  provider: z.enum(['claude', 'codex']),
  model: z.string().trim().min(1),
  auth: authSchema,
  dryRun: z.boolean().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const json = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', message: 'Bad/missing fields.' }, { status: 400 });
  }

  let client;
  try {
    client = await buildMmaClient();
  } catch {
    return NextResponse.json({ error: 'mma_unavailable', message: 'Could not reach mma.' }, { status: 502 });
  }

  try {
    const result = await client.configureProvider(parsed.data as ConfigureProviderRequest);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'configure_failed', message: (err as Error)?.message ?? 'configure-provider failed' },
      { status: 502 },
    );
  }
}
