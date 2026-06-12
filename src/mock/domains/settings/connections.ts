import { MockTable } from '@/mock/store';
import { mockLatency } from '@/mock/config';
import seed from '@/mock/seed/connections.json';
import type { ConnectionsView, UpdateConnectionsResult } from '@/config/connections-core';

// The connections singleton is stored as a one-row table.
interface ConnectionsRecord {
  mmaBaseUrl: string | null;
  mmaTokenSet: boolean;
  gitTokenSet: boolean;
  openaiTranscriptionKeySet: boolean;
}

const table = new MockTable<ConnectionsRecord>('connections', () => seed as ConnectionsRecord[]);

function singleton(): ConnectionsRecord {
  return (
    table.all()[0] ?? {
      mmaBaseUrl: null,
      mmaTokenSet: false,
      gitTokenSet: false,
      openaiTranscriptionKeySet: false,
    }
  );
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function getConnections(): Promise<ConnectionsView> {
  await mockLatency();
  return { ...singleton() };
}

export async function updateConnections(input: unknown): Promise<UpdateConnectionsResult> {
  await mockLatency();
  const i = (input ?? {}) as Record<string, unknown>;
  const current = singleton();

  const patch: Partial<ConnectionsRecord> = {};
  if (typeof i.mmaBaseUrl === 'string') patch.mmaBaseUrl = i.mmaBaseUrl.trim() || null;
  // A present, non-empty token rotates → "set"; absent/empty leaves it unchanged
  // (the endpoint can set/rotate a secret but not clear it via this path).
  if (str(i.mmaToken).trim() !== '') patch.mmaTokenSet = true;
  if (str(i.gitToken).trim() !== '') patch.gitTokenSet = true;
  if (str(i.openaiTranscriptionKey).trim() !== '') patch.openaiTranscriptionKeySet = true;

  const next: ConnectionsRecord = { ...current, ...patch };
  // Persist (replace the single row).
  table.remove(() => true);
  table.insert(next);
  return { kind: 'saved', connections: { ...next } };
}
