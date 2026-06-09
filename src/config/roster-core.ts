import { eq, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { agentTier, provider } from '@/db/schema/config';
import { AGENT_TIER, type AgentTier } from '@/db/enums';

/**
 * Agent-roster core (Spec 2 §Agent roster). The three `agent_tier` rows
 * (main/complex/standard) are seeded once (seed-config.ts); this module only
 * READs and UPDATEs them by `tier` — it never inserts or deletes tier rows.
 *
 * Each tier picks a configured provider + a model (model is FREE-TEXT for now;
 * Part B wires the model-profiles dropdown). A tier may be cleared (provider +
 * model both NULL). The Save-&-apply config write (Part B) is out of scope here.
 */

export interface RosterDeps {
  db?: Db;
}

/** A tier row as read for the roster tab. */
export interface RosterRow {
  tier: AgentTier;
  providerId: string | null;
  model: string | null;
  updatedAt: Date;
}

/** Read all three tier rows (ordered main, complex, standard). */
export async function listRoster(deps: RosterDeps = {}): Promise<RosterRow[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({
      tier: agentTier.tier,
      providerId: agentTier.providerId,
      model: agentTier.model,
      updatedAt: agentTier.updatedAt,
    })
    .from(agentTier);
  // Canonical tier order, independent of insertion order.
  const order = new Map(AGENT_TIER.map((t, i) => [t, i]));
  return [...rows].sort((a, b) => (order.get(a.tier) ?? 0) - (order.get(b.tier) ?? 0));
}

// A single tier assignment. providerId+model both null → cleared tier.
// A non-null providerId requires a non-empty model and vice-versa (a tier is
// either fully set or fully cleared).
const tierUpdateSchema = z
  .object({
    tier: z.enum(AGENT_TIER),
    providerId: z.string().uuid().nullable().optional(),
    model: z
      .string()
      .trim()
      .transform((s) => (s === '' ? null : s))
      .nullable()
      .optional(),
  })
  .transform((v) => ({
    tier: v.tier,
    providerId: v.providerId ?? null,
    model: v.model ?? null,
  }))
  .refine((v) => (v.providerId === null) === (v.model === null), {
    message: 'A tier must set both a provider and a model, or clear both.',
  });

export const updateRosterSchema = z.object({
  tiers: z.array(tierUpdateSchema).min(1),
});
export type UpdateRosterInput = z.infer<typeof updateRosterSchema>;

export type UpdateRosterResult =
  | { kind: 'updated'; roster: RosterRow[] }
  | { kind: 'invalid'; message?: string }
  | { kind: 'unknown_provider' };

/**
 * Update one or more tier rows by `tier`. Validates that each non-cleared tier
 * references an existing provider. Returns the full refreshed roster. Never
 * inserts/deletes tier rows (an unknown tier value is rejected by the enum).
 */
export async function updateRoster(
  input: unknown,
  deps: RosterDeps = {},
): Promise<UpdateRosterResult> {
  const db = deps.db ?? getDb();
  const parsed = updateRosterSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: 'invalid', message: parsed.error.issues[0]?.message };
  }

  // Validate referenced providers exist (FK would also reject, but we want a
  // clean domain result, not a thrown constraint error).
  const referenced = parsed.data.tiers
    .map((t) => t.providerId)
    .filter((p): p is string => p !== null);
  if (referenced.length > 0) {
    const found = await db
      .select({ id: provider.id })
      .from(provider)
      .where(inArray(provider.id, referenced));
    const foundIds = new Set(found.map((r) => r.id));
    if (referenced.some((id) => !foundIds.has(id))) return { kind: 'unknown_provider' };
  }

  await db.transaction(async (tx) => {
    for (const t of parsed.data.tiers) {
      await tx
        .update(agentTier)
        .set({ providerId: t.providerId, model: t.model, updatedAt: sql`now()` })
        .where(eq(agentTier.tier, t.tier));
    }
  });

  return { kind: 'updated', roster: await listRoster({ db }) };
}
