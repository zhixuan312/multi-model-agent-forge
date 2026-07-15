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

export interface UpdateComponentGovernanceInput {
  slots: Partial<Record<GovernanceSlotId, PersistedGovernanceSlotState>>;
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
    if (!state.knobs || typeof state.knobs !== 'object') return false;

    const schema = GOVERNANCE_REGISTRY[slotId as GovernanceSlotId].knobs;
    const defs = new Map(schema.map((def) => [def.name, def]));
    for (const [name, value] of Object.entries(state.knobs)) {
      const def = defs.get(name);
      if (!def) return false;
      if (!isAllowed(def, value)) return false;
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
  const [existing] = await db.select().from(componentGovernanceSettings).limit(1);
  const merged = {
    ...(existing?.slotStateJson ?? {}),
    ...input.slots,
  } as Partial<Record<GovernanceSlotId, PersistedGovernanceSlotState>>;

  if (existing) {
    await db
      .update(componentGovernanceSettings)
      .set({ slotStateJson: merged, updatedAt: new Date() })
      .where(eq(componentGovernanceSettings.id, existing.id));
  } else {
    await db.insert(componentGovernanceSettings).values({ slotStateJson: merged });
  }

  return {
    kind: 'saved',
    governance: await getComponentGovernanceView({ db }),
  };
}
