import { randomUUID } from 'node:crypto';
import { MockTable } from '@/mock/store';
import { mockLatency } from '@/mock/config';
import { PASSWORD_MIN_LENGTH } from '@/auth/config';
import seed from '@/mock/seed/members.json';
// Type-only imports — erased at runtime, so no cycle with members-core (which
// imports this module at runtime for its mock guards).
import type {
  MemberListRow,
  CreateMemberResult,
  SetAdminResult,
  ResetPasswordResult,
  DeleteMemberResult,
} from '@/auth/members-core';

interface MemberRecord {
  id: string;
  username: string;
  displayName: string;
  avatarTint: string;
  isAdmin: boolean;
  createdAt: string; // ISO
}

const table = new MockTable<MemberRecord>('members', () => seed as MemberRecord[]);

const TINTS = ['#c4521e', '#4e7350', '#355a74', '#a9761a', '#b23a48', '#7a5230', '#46695f', '#8a5a2b'];

function toRow(r: MemberRecord): MemberListRow {
  return {
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    avatarTint: r.avatarTint,
    isAdmin: r.isAdmin,
    createdAt: new Date(r.createdAt),
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function listMembers(): Promise<MemberListRow[]> {
  await mockLatency();
  return table
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toRow);
}

/** A plausible, stable active-session count for the metric. */
export async function countActiveSessions(): Promise<number> {
  await mockLatency();
  return 9;
}

export async function createMember(input: unknown): Promise<CreateMemberResult> {
  await mockLatency();
  const i = (input ?? {}) as Record<string, unknown>;
  const displayName = str(i.displayName).trim();
  const username = str(i.username).trim();
  const password = str(i.password);
  if (displayName === '' || username === '' || password.length < PASSWORD_MIN_LENGTH) {
    return { kind: 'invalid' };
  }
  if (table.all().some((m) => m.username.toLowerCase() === username.toLowerCase())) {
    return { kind: 'duplicate_username' };
  }
  const rec: MemberRecord = {
    id: randomUUID(),
    username,
    displayName,
    avatarTint: TINTS[table.all().length % TINTS.length]!,
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };
  table.insert(rec);
  return {
    kind: 'created',
    member: { id: rec.id, username, displayName, avatarTint: rec.avatarTint, isAdmin: false },
  };
}

export async function setMemberAdmin(memberId: string, input: unknown): Promise<SetAdminResult> {
  await mockLatency();
  const next = (input as { isAdmin?: unknown } | null)?.isAdmin;
  if (typeof next !== 'boolean') return { kind: 'invalid' };
  const all = table.all();
  const target = all.find((m) => m.id === memberId);
  if (!target) return { kind: 'not_found' };
  if (target.isAdmin && !next && all.filter((m) => m.isAdmin && m.id !== memberId).length === 0) {
    return { kind: 'last_admin' };
  }
  table.update((m) => m.id === memberId, { isAdmin: next });
  return { kind: 'updated', id: memberId, isAdmin: next };
}

export async function resetMemberPassword(memberId: string, input: unknown): Promise<ResetPasswordResult> {
  await mockLatency();
  const pw = str((input as { newPassword?: unknown } | null)?.newPassword);
  if (pw.length < PASSWORD_MIN_LENGTH) return { kind: 'invalid' };
  if (!table.find((m) => m.id === memberId)) return { kind: 'not_found' };
  // Passwords aren't stored in the mock DB — the reset simply succeeds.
  return { kind: 'reset' };
}

export async function deleteMember(memberId: string): Promise<DeleteMemberResult> {
  await mockLatency();
  const all = table.all();
  const target = all.find((m) => m.id === memberId);
  if (!target) return { kind: 'not_found' };
  if (target.isAdmin && all.filter((m) => m.isAdmin && m.id !== memberId).length === 0) {
    return { kind: 'last_admin' };
  }
  table.remove((m) => m.id === memberId);
  return { kind: 'deleted' };
}
