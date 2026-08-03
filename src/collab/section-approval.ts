/**
 * Pure participant-list logic for a co-approved unit. No React, no DB — the reusable
 * core the Spec-craft UI drives when it edits a section's participants.
 *
 * The governing rule — a unit's human gate is satisfied when AT LEAST ONE participant
 * has approved (§"≥1 is good to go"), everyone else pending being shown for visibility
 * rather than as a hard block — is NOT decided here. The client never gets to vote on
 * its own gate: the server derives `humanSatisfied` from `details.…components[].approvals`
 * in `loadOutline` (spec-core.ts) and ships the answer. This module previously carried an
 * `isHumanApproved` that restated the rule over the client's `Participant[]` and that
 * nothing called — two places to change one rule, one of them unreachable.
 */
import type { MemberRef, Participant } from './types';

/** Participants still expected but not yet approved (drives the panel + nudge). */
export function pending(ps: Participant[]): Participant[] {
  return ps.filter((p) => !p.approved);
}

/** Has this specific member already approved? */
export function hasApproved(ps: Participant[], memberId: string): boolean {
  return ps.some((p) => p.member.id === memberId && p.approved);
}

/**
 * Add a member as a participant if not already present (idempotent). Mentioning
 * someone already on the unit is a no-op on the list (they may still be
 * re-notified by the caller).
 */
export function addParticipant(
  ps: Participant[],
  member: MemberRef,
): Participant[] {
  if (ps.some((p) => p.member.id === member.id)) return ps;
  return [...ps, { member, approved: false }];
}

/**
 * Record `member`'s approval. Self-joins them as a participant if they weren't one
 * (an ad-hoc approver is still tracked). No-op if already approved.
 */
export function recordApproval(
  ps: Participant[],
  member: MemberRef,
): Participant[] {
  const base = ps.some((p) => p.member.id === member.id)
    ? ps
    : [...ps, { member, approved: false }];
  return base.map((p) => (p.member.id === member.id ? { ...p, approved: true } : p));
}
