import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { componentGovernanceSettings } from '@/db/schema/identity';
import {
  GOVERNANCE_REGISTRY,
  type ComponentGovernanceView,
  type GovernanceKnobDefinition,
  type GovernanceKnobValues,
  type GovernanceSlotId,
  type GovernanceSlotView,
  type PersistedGovernanceSlotState,
} from '@/components/governance/registry';

// The view types are defined in the client-safe registry module and re-exported
// here for server-side callers. Client (`'use client'`) code must import them from
// `@/components/governance/registry` directly, never from this server-only module.
export type { ComponentGovernanceView, GovernanceSlotView } from '@/components/governance/registry';

export interface GovernanceDeps {
  db?: Db;
}

/**
 * A per-slot patch. `locked` is always sent; `knobs` is a PARTIAL set of only the
 * changed knobs. The server deep-merges these onto the existing stored knobs, so a
 * partial payload never drops the omitted knobs (no silent data loss) and two edits
 * to different knobs of the same slot don't clobber each other.
 */
export interface GovernanceSlotPatch {
  locked: boolean;
  knobs?: Partial<GovernanceKnobValues>;
}

export interface UpdateComponentGovernanceInput {
  slots: Partial<Record<GovernanceSlotId, GovernanceSlotPatch>>;
}

export type UpdateComponentGovernanceResult =
  | { kind: 'saved'; governance: ComponentGovernanceView }
  | { kind: 'invalid'; message: string };

function defaultKnobs(slotId: GovernanceSlotId): GovernanceKnobValues {
  return Object.fromEntries(
    GOVERNANCE_REGISTRY[slotId].knobs.map((knob) => [knob.name, knob.defaultValue]),
  );
}

function isAllowed(def: GovernanceKnobDefinition, value: unknown): boolean {
  return def.allowedValues.some((allowed) => allowed === value);
}

function buildSlotView(
  slotId: GovernanceSlotId,
  stored: Partial<Record<GovernanceSlotId, PersistedGovernanceSlotState>>,
): GovernanceSlotView {
  const entry = GOVERNANCE_REGISTRY[slotId];
  const persisted = stored[slotId];
  const knobs = defaultKnobs(slotId);

  if (persisted) {
    for (const def of entry.knobs) {
      const next = persisted.knobs?.[def.name];
      if (isAllowed(def, next)) knobs[def.name] = next as string | boolean;
    }
  }

  return {
    slotId,
    label: entry.label,
    group: entry.group,
    canonicalComponent: entry.canonicalComponent,
    canonicalFilePath: entry.canonicalFilePath,
    knobSchema: entry.knobs,
    consumers: entry.consumers,
    deviations: entry.deviations,
    locked: persisted?.locked ?? entry.defaultLocked,
    knobs,
  };
}

function validateUpdate(input: unknown): input is UpdateComponentGovernanceInput {
  if (!input || typeof input !== 'object') return false;
  const payload = input as UpdateComponentGovernanceInput;
  if (!payload.slots || typeof payload.slots !== 'object') return false;

  for (const [slotId, state] of Object.entries(payload.slots)) {
    if (!(slotId in GOVERNANCE_REGISTRY)) return false;
    if (!state || typeof state !== 'object' || typeof state.locked !== 'boolean') return false;
    // `knobs` is an optional partial patch. When present, every provided knob must be
    // a real knob for this slot with an allowed value; omitted knobs are left untouched.
    if (state.knobs !== undefined) {
      if (typeof state.knobs !== 'object' || state.knobs === null) return false;
      const schema = GOVERNANCE_REGISTRY[slotId as GovernanceSlotId].knobs;
      const defs = new Map(schema.map((def) => [def.name, def]));
      for (const [name, value] of Object.entries(state.knobs)) {
        const def = defs.get(name);
        if (!def) return false;
        if (!isAllowed(def, value)) return false;
      }
    }
  }

  return true;
}

export async function getComponentGovernanceView(
  deps: GovernanceDeps = {},
): Promise<ComponentGovernanceView> {
  const db = deps.db ?? getDb();
  const [row] = await db.select().from(componentGovernanceSettings).limit(1);
  const stored = (row?.slotStateJson ?? {}) as Partial<Record<GovernanceSlotId, PersistedGovernanceSlotState>>;
  const slotIds = Object.keys(GOVERNANCE_REGISTRY) as GovernanceSlotId[];
  return {
    slots: slotIds.map((slotId) => buildSlotView(slotId, stored)),
  };
}

export async function resolveGovernedSlot(
  slotId: GovernanceSlotId,
  deps: GovernanceDeps = {},
) {
  const view = await getComponentGovernanceView(deps);
  const match = view.slots.find((slot) => slot.slotId === slotId);
  if (!match) throw new Error(`Unknown governance slot: ${slotId}`);
  return { slotId: match.slotId, locked: match.locked, knobs: match.knobs };
}

export async function updateComponentGovernance(
  input: unknown,
  deps: GovernanceDeps = {},
): Promise<UpdateComponentGovernanceResult> {
  if (!validateUpdate(input)) return { kind: 'invalid', message: 'Invalid governance fields.' };

  const db = deps.db ?? getDb();

  // Deep-merge each patch onto a base: keep the base's other slots, and for each
  // patched slot keep its unmentioned knobs — only the provided knobs change. This
  // makes partial payloads safe (no silent knob loss) and reduces clobbering between
  // concurrent single-knob edits.
  const mergeInto = (
    base: Partial<Record<GovernanceSlotId, PersistedGovernanceSlotState>>,
  ): Partial<Record<GovernanceSlotId, PersistedGovernanceSlotState>> => {
    const next = { ...base };
    for (const [slotId, patch] of Object.entries(input.slots) as [GovernanceSlotId, GovernanceSlotPatch][]) {
      next[slotId] = {
        locked: patch.locked,
        // Validated patches never carry undefined values, so the spread of a partial
        // knob map is safe to treat as a full GovernanceKnobValues.
        knobs: { ...(base[slotId]?.knobs ?? {}), ...(patch.knobs ?? {}) } as GovernanceKnobValues,
      };
    }
    return next;
  };

  const asStored = (v: unknown) => (v ?? {}) as Partial<Record<GovernanceSlotId, PersistedGovernanceSlotState>>;

  // Serialize concurrent writers: lock the singleton row FOR UPDATE inside a
  // transaction so the read-merge-write is atomic and cannot lose a concurrent
  // writer's changes (the previous non-transactional read-merge-write allowed two
  // requests to read the same base and clobber each other). On the very first write
  // (no row yet) a lost insert race surfaces as a unique-violation on the
  // unique-on-(true) index, which we recover by re-reading the now-locked row and
  // updating instead of surfacing a 500.
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(componentGovernanceSettings).for('update').limit(1);
    if (existing) {
      await tx
        .update(componentGovernanceSettings)
        .set({ slotStateJson: mergeInto(asStored(existing.slotStateJson)), updatedAt: new Date() })
        .where(eq(componentGovernanceSettings.id, existing.id));
      return;
    }
    try {
      await tx.insert(componentGovernanceSettings).values({ slotStateJson: mergeInto({}) });
    } catch (err) {
      const [now] = await tx.select().from(componentGovernanceSettings).for('update').limit(1);
      if (!now) throw err;
      await tx
        .update(componentGovernanceSettings)
        .set({ slotStateJson: mergeInto(asStored(now.slotStateJson)), updatedAt: new Date() })
        .where(eq(componentGovernanceSettings.id, now.id));
    }
  });

  return {
    kind: 'saved',
    governance: await getComponentGovernanceView({ db }),
  };
}
