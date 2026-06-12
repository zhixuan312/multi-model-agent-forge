import { randomUUID } from 'node:crypto';
import { MockTable } from '@/mock/store';
import { mockLatency } from '@/mock/config';
import seed from '@/mock/seed/providers.json';
import type {
  ProviderView,
  CreateProviderResult,
  UpdateProviderResult,
  DeleteProviderResult,
} from '@/config/providers-core';

type ProviderType = 'claude' | 'codex';

interface ProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  apiKeySet: boolean;
  createdAt: string; // ISO
  models: string[]; // mock-only: the models this provider serves
}

const table = new MockTable<ProviderRecord>('providers', () => seed as ProviderRecord[]);

function toView(r: ProviderRecord): ProviderView {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    baseUrl: r.baseUrl,
    apiKeySet: r.apiKeySet,
    createdAt: new Date(r.createdAt),
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function listProviders(): Promise<ProviderView[]> {
  await mockLatency();
  return table
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toView);
}

/** providerId → the models that provider serves (mock-only; real backend TBD). */
export async function getModelsByProvider(): Promise<Record<string, string[]>> {
  await mockLatency();
  return Object.fromEntries(table.all().map((p) => [p.id, p.models ?? []]));
}

/** Live provider ids (no latency) — used internally by the roster mock to validate refs. */
export function liveProviderIds(): Set<string> {
  return new Set(table.all().map((p) => p.id));
}

export async function createProvider(input: unknown): Promise<CreateProviderResult> {
  await mockLatency();
  const i = (input ?? {}) as Record<string, unknown>;
  const name = str(i.name).trim();
  const type = str(i.type) as ProviderType;
  if (name === '' || (type !== 'claude' && type !== 'codex')) return { kind: 'invalid' };
  if (table.all().some((p) => p.name === name)) return { kind: 'duplicate_name' };

  const baseUrl = str(i.baseUrl).trim() || null;
  const apiKeySet = str(i.apiKey).trim() !== '';
  const rec: ProviderRecord = {
    id: randomUUID(),
    name,
    type,
    baseUrl,
    apiKeySet,
    createdAt: new Date().toISOString(),
    models: [],
  };
  table.insert(rec);
  return { kind: 'created', provider: toView(rec) };
}

export async function updateProvider(id: string, input: unknown): Promise<UpdateProviderResult> {
  await mockLatency();
  const i = (input ?? {}) as Record<string, unknown>;
  const current = table.find((p) => p.id === id);
  if (!current) return { kind: 'not_found' };

  const patch: Partial<ProviderRecord> = {};
  if ('name' in i) {
    const name = str(i.name).trim();
    if (name === '') return { kind: 'invalid' };
    if (name !== current.name && table.all().some((p) => p.name === name)) {
      return { kind: 'duplicate_name' };
    }
    patch.name = name;
  }
  if ('type' in i) {
    const type = str(i.type) as ProviderType;
    if (type !== 'claude' && type !== 'codex') return { kind: 'invalid' };
    patch.type = type;
  }
  // baseUrl: present key → set (empty clears to null); absent → unchanged.
  if ('baseUrl' in i) patch.baseUrl = str(i.baseUrl).trim() || null;
  // apiKey: non-empty → a key is now set; explicit empty → cleared.
  if ('apiKey' in i) patch.apiKeySet = str(i.apiKey).trim() !== '';

  const updated = table.update((p) => p.id === id, patch) ?? current;
  return { kind: 'updated', provider: toView(updated) };
}

export async function deleteProvider(id: string): Promise<DeleteProviderResult> {
  await mockLatency();
  if (!table.find((p) => p.id === id)) return { kind: 'not_found' };
  table.remove((p) => p.id === id);
  return { kind: 'deleted' };
}
