/**
 * Pure participant/approval logic for a co-approved unit. No React, no DB — the
 * reusable core the Spec-craft UI (and later stages) drive. The governing rule:
 * a unit's human gate is satisfied when AT LEAST ONE participant has approved
 * (§"≥1 is good to go"); everyone else who's pending is shown for visibility,
 * not as a hard block.
 */
import type { MemberRef, Participant } from './types';

/** Participants who have nodded. */
export function approvers(ps: Participant[]): Participant[] {
  return ps.filter((p) => p.approvedAt !== null);
}

/** Participants still expected but not yet approved (drives the panel + nudge). */
export function pending(ps: Participant[]): Participant[] {
  return ps.filter((p) => p.approvedAt === null);
}

/** Human gate: true once any one participant has approved. */
export function isHumanApproved(ps: Participant[]): boolean {
  return approvers(ps).length > 0;
}

/** Has this specific member already approved? */
export function hasApproved(ps: Participant[], memberId: string): boolean {
  return ps.some((p) => p.member.id === memberId && p.approvedAt !== null);
}

/**
 * Add a member as a participant if not already present (idempotent). Mentioning
 * someone already on the unit is a no-op on the list (they may still be
 * re-notified by the caller).
 */
export function addParticipant(
  ps: Participant[],
  member: MemberRef,
  addedBy: string | null,
): Participant[] {
  if (ps.some((p) => p.member.id === member.id)) return ps;
  return [...ps, { member, addedBy, approvedAt: null }];
}

/**
 * Record `member`'s approval at `at`. Self-joins them as a participant if they
 * weren't one (an ad-hoc approver is still tracked). No-op if already approved.
 */
export function recordApproval(
  ps: Participant[],
  member: MemberRef,
  at: string,
): Participant[] {
  const base = ps.some((p) => p.member.id === member.id)
    ? ps
    : [...ps, { member, addedBy: null, approvedAt: null }];
  return base.map((p) =>
    p.member.id === member.id && p.approvedAt === null ? { ...p, approvedAt: at } : p,
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract @-mentions from free text, resolving against a member pool by display
 * name. Longest names match first and are consumed, so "@Bo Chen" resolves to
 * Bo Chen — not also a shorter "Bo". Case-insensitive; order follows the pool's
 * longest-first match order. Unresolvable `@text` is ignored (no throw).
 */
export function parseMentions(text: string, pool: MemberRef[]): MemberRef[] {
  let work = text;
  const hits: MemberRef[] = [];
  const byLen = [...pool].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const m of byLen) {
    const re = new RegExp(`@${escapeRegExp(m.displayName)}(?![\\w])`, 'i');
    if (re.test(work)) {
      hits.push(m);
      work = work.replace(re, ' '); // consume so a shorter prefix can't re-match
    }
  }
  return hits;
}
