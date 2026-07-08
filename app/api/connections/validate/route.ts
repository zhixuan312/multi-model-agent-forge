import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
import { getDb } from '@/db/client';
import { connectionSettings } from '@/db/schema/identity';
import { team } from '@/db/schema/team';
import { PostgresSecretStore } from '@/secrets/secret-store';
import { buildMmaClient } from '@/mma/server-client';
import { probeGit, probeOpenai } from '@/config/connections-probe';

/**
 * Admin "Validate connection" probe (Connections tab). Reports whether a
 * connection actually works, never echoing secrets:
 *   - mma    → the resolved client's health + status (bearer auto-resolved)
 *   - git    → probe the git host with the typed token, else the stored one
 *   - openai → list models with the typed key, else the stored one
 * Returns `{ ok, detail }`.
 */
const schema = z.object({
  type: z.enum(['mma', 'git', 'openai']),
  token: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', message: 'Bad/missing fields.' }, { status: 400 });
  }
  const { type, token } = parsed.data;

  if (type === 'mma') {
    try {
      const client = await buildMmaClient();
      const health = await client.health();
      const status = await client.status();
      const ok = health.status !== 'unreachable' && status.authValid;
      const detail =
        health.status === 'unreachable'
          ? 'Cannot reach mma.'
          : !status.authValid
            ? 'mma rejected the bearer token.'
            : 'Connected to mma.';
      return NextResponse.json({ ok, detail });
    } catch {
      return NextResponse.json({ ok: false, detail: 'Cannot reach mma.' });
    }
  }

  // git / openai — use the typed token if present, else decrypt the stored one.
  let value = token?.trim() ?? '';
  if (!value) {
    const db = getDb();
    const [org] = await db.select().from(connectionSettings).limit(1);
    const [currentTeam] = gate.actor.teamId
      ? await db.select().from(team).where(eq(team.id, gate.actor.teamId)).limit(1)
      : [null];
    const ref = type === 'git' ? (currentTeam?.gitTokenRef ?? null) : (org?.openaiTranscriptionKeyRef ?? null);
    if (ref) {
      const secrets = await PostgresSecretStore.create({});
      value = (await secrets.get(ref)) ?? '';
    }
  }

  const result = type === 'git' ? await probeGit(value) : await probeOpenai(value, null);
  return NextResponse.json(result);
}
