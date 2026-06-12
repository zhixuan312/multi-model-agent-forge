import { MockTable } from '@/mock/store';
import { mockLatency } from '@/mock/config';
import seed from '@/mock/seed/roster.json';
import { liveProviderIds } from '@/mock/domains/settings/providers';
import type { RosterRow, UpdateRosterResult } from '@/config/roster-core';

type Tier = 'main' | 'complex' | 'standard';
const TIER_ORDER: Tier[] = ['main', 'complex', 'standard'];

interface RosterRecord {
  tier: Tier;
  providerId: string | null;
  model: string | null;
  updatedAt: string; // ISO
}

const table = new MockTable<RosterRecord>('roster', () => seed as RosterRecord[]);

function toRow(r: RosterRecord): RosterRow {
  return { tier: r.tier, providerId: r.providerId, model: r.model, updatedAt: new Date(r.updatedAt) };
}

export async function listRoster(): Promise<RosterRow[]> {
  await mockLatency();
  return table
    .all()
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    .map(toRow);
}

export async function updateRoster(input: unknown): Promise<UpdateRosterResult> {
  await mockLatency();
  const tiers = (input as { tiers?: unknown } | null)?.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) return { kind: 'invalid' };

  const normalized: RosterRecord[] = [];
  for (const raw of tiers) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const tier = t.tier as Tier;
    if (!TIER_ORDER.includes(tier)) return { kind: 'invalid', message: 'Unknown tier.' };
    const providerId = typeof t.providerId === 'string' && t.providerId !== '' ? t.providerId : null;
    const model = typeof t.model === 'string' && t.model.trim() !== '' ? t.model.trim() : null;
    // both-or-neither rule
    if ((providerId === null) !== (model === null)) {
      return { kind: 'invalid', message: 'A tier must set both a provider and a model, or clear both.' };
    }
    normalized.push({ tier, providerId, model, updatedAt: new Date().toISOString() });
  }

  // Referenced providers must exist.
  const ids = liveProviderIds();
  if (normalized.some((t) => t.providerId !== null && !ids.has(t.providerId))) {
    return { kind: 'unknown_provider' };
  }

  for (const t of normalized) {
    table.update((r) => r.tier === t.tier, { providerId: t.providerId, model: t.model, updatedAt: t.updatedAt });
  }
  return { kind: 'updated', roster: await listRoster() };
}
