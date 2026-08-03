import {
  pending,
  hasApproved,
  addParticipant,
  recordApproval
} from '@/collab/section-approval';
import type { MemberRef, Participant } from '@/collab/types';

const bo: MemberRef = { id: 'bo', displayName: 'Bo Chen', avatarTint: '#355a74' };
const priya: MemberRef = { id: 'priya', displayName: 'Priya Nair', avatarTint: '#b23a48' };
const me: MemberRef = { id: 'me', displayName: 'admin', avatarTint: '#c4521e' };

function parts(): Participant[] {
  return [
    { member: bo, approved: true },
    { member: priya, approved: false },
  ];
}

describe('section-approval gate logic', () => {
  it('pending lists exactly those who have not approved', () => {
    expect(pending(parts()).map((p) => p.member.id)).toEqual(['priya']);
  });

  it('hasApproved is per-member', () => {
    expect(hasApproved(parts(), 'bo')).toBe(true);
    expect(hasApproved(parts(), 'priya')).toBe(false);
  });
});

describe('addParticipant', () => {
  it('adds a new member as pending', () => {
    const next = addParticipant([], bo);
    expect(next).toEqual([{ member: bo, approved: false }]);
  });

  it('is idempotent — mentioning an existing participant does not duplicate', () => {
    const start = addParticipant([], bo);
    const again = addParticipant(start, bo);
    expect(again).toBe(start); // unchanged reference
    expect(again).toHaveLength(1);
  });
});

/**
 * Approval is a boolean, never a timestamp. The server persists only `approvedBy`
 * (member ids), so nothing can rehydrate WHEN someone nodded — the old
 * `approvedAt: string | null` was re-seeded with a fabricated `new Date()` at five
 * sites, and no consumer ever read the value.
 */
describe('recordApproval', () => {
  it('marks an existing participant approved', () => {
    const start: Participant[] = [{ member: priya, approved: false }];
    expect(recordApproval(start, priya)[0]!.approved).toBe(true);
  });

  it('self-joins a non-participant who approves', () => {
    expect(recordApproval([], me)).toEqual([{ member: me, approved: true }]);
  });

  it('leaves an already-approved member approved', () => {
    const start: Participant[] = [{ member: bo, approved: true }];
    expect(recordApproval(start, bo)).toEqual([{ member: bo, approved: true }]);
  });

  it('touches only the approving member', () => {
    const next = recordApproval(parts(), priya);
    expect(next.map((p) => [p.member.id, p.approved])).toEqual([['bo', true], ['priya', true]]);
  });
});
