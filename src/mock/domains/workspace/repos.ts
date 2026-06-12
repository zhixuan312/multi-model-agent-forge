import { randomUUID, randomBytes } from 'node:crypto';
import { MockTable } from '@/mock/store';
import { mockLatency } from '@/mock/config';
import seed from '@/mock/seed/repos.json';
// Type-only imports — erased at runtime, so no cycle with repos-core (which
// imports this module at runtime for its mock guards).
import type { RepoView, CloneRepoResult, PullResult, DeleteRepoResult } from '@/git/repos-core';

interface RepoRecord {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
  kind: string;
  tags: string[];
  headSha: string | null;
  status: 'cloned' | 'pulling' | 'error';
  createdAt: string; // ISO
}

const table = new MockTable<RepoRecord>('repos', () => seed as RepoRecord[]);

function toView(r: RepoRecord): RepoView {
  return {
    id: r.id,
    name: r.name,
    pathOnDisk: r.pathOnDisk,
    defaultBranch: r.defaultBranch,
    kind: r.kind,
    tags: r.tags,
    headSha: r.headSha,
    status: r.status,
    createdAt: new Date(r.createdAt),
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const sha = () => randomBytes(20).toString('hex');

export async function listRepos(): Promise<RepoView[]> {
  await mockLatency();
  return table
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toView);
}

/** Clone (Flow B) — the mock skips the real git work and lands the repo cloned. */
export async function cloneAndRegister(input: unknown): Promise<CloneRepoResult> {
  await mockLatency(600);
  const i = (input ?? {}) as Record<string, unknown>;
  const name = str(i.name).trim();
  const url = str(i.url).trim();
  const kind = str(i.kind).trim() || 'service';
  const tags = Array.isArray(i.tags) ? i.tags.map((t) => str(t).trim()).filter(Boolean) : [];

  if (name === '' || url === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return { kind: 'invalid', message: 'Name must be a simple directory name (no slashes or "..").' };
  }
  if (table.all().some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    return { kind: 'duplicate_name' };
  }

  const rec: RepoRecord = {
    id: randomUUID(),
    name,
    pathOnDisk: name,
    defaultBranch: 'main',
    kind,
    tags,
    headSha: sha(),
    status: 'cloned',
    createdAt: new Date().toISOString(),
  };
  table.insert(rec);
  return { kind: 'cloned', repo: toView(rec) };
}

/** Re-pull — the mock advances the head SHA and lands the repo cloned. */
export async function pullExisting(id: string): Promise<PullResult> {
  await mockLatency(600);
  const row = table.find((r) => r.id === id);
  if (!row) return { kind: 'not_found' };
  const updated = table.update((r) => r.id === id, { headSha: sha(), status: 'cloned' });
  return { kind: 'pulled', repo: toView(updated ?? row) };
}

export async function deleteRepo(id: string): Promise<DeleteRepoResult> {
  await mockLatency();
  return table.remove((r) => r.id === id) ? { kind: 'deleted' } : { kind: 'not_found' };
}
