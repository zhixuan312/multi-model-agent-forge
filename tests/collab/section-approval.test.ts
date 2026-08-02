import {
  approvers,
  pending,
  isHumanApproved,
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
    { member: bo, approvedAt: '2026-06-13T09:40:00.000Z' },
    { member: priya, approvedAt: null },
  ];
}

describe('section-approval gate logic', () => {
  it('approvers / pending partition the list by approvedAt', () => {
    expect(approvers(parts()).map((p) => p.member.id)).toEqual(['bo']);
    expect(pending(parts()).map((p) => p.member.id)).toEqual(['priya']);
  });

  it('isHumanApproved is true once any one participant has approved (≥1 is enough)', () => {
    expect(isHumanApproved(parts())).toBe(true);
    expect(isHumanApproved([{ member: priya, approvedAt: null }])).toBe(false);
    expect(isHumanApproved([])).toBe(false);
  });

  it('hasApproved is per-member', () => {
    expect(hasApproved(parts(), 'bo')).toBe(true);
    expect(hasApproved(parts(), 'priya')).toBe(false);
  });
});

describe('addParticipant', () => {
  it('adds a new member as pending', () => {
    const next = addParticipant([], bo);
    expect(next).toEqual([{ member: bo, approvedAt: null }]);
  });

  it('is idempotent — mentioning an existing participant does not duplicate', () => {
    const start = addParticipant([], bo);
    const again = addParticipant(start, bo);
    expect(again).toBe(start); // unchanged reference
    expect(again).toHaveLength(1);
  });
});

describe('recordApproval', () => {
  it('marks an existing participant approved at the given time', () => {
    const start: Participant[] = [{ member: priya, approvedAt: null }];
    const next = recordApproval(start, priya, '2026-06-13T10:00:00.000Z');
    expect(next[0]!.approvedAt).toBe('2026-06-13T10:00:00.000Z');
  });

  it('self-joins a non-participant who approves', () => {
    const next = recordApproval([], me, '2026-06-13T10:00:00.000Z');
    expect(next).toEqual([{ member: me, approvedAt: '2026-06-13T10:00:00.000Z' }]);
  });

  it('is a no-op if the member already approved (keeps original timestamp)', () => {
    const start: Participant[] = [{ member: bo, approvedAt: '2026-06-13T09:00:00.000Z' }];
    const next = recordApproval(start, bo, '2026-06-13T11:00:00.000Z');
    expect(next[0]!.approvedAt).toBe('2026-06-13T09:00:00.000Z');
  });
});
