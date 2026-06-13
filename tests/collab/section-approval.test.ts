import {
  approvers,
  pending,
  isHumanApproved,
  hasApproved,
  addParticipant,
  recordApproval,
  parseMentions,
} from '@/collab/section-approval';
import type { MemberRef, Participant } from '@/collab/types';

const bo: MemberRef = { id: 'bo', displayName: 'Bo Chen', avatarTint: '#355a74' };
const priya: MemberRef = { id: 'priya', displayName: 'Priya Nair', avatarTint: '#b23a48' };
const me: MemberRef = { id: 'me', displayName: 'admin', avatarTint: '#c4521e' };

function parts(): Participant[] {
  return [
    { member: bo, addedBy: 'me', approvedAt: '2026-06-13T09:40:00.000Z' },
    { member: priya, addedBy: 'me', approvedAt: null },
  ];
}

describe('section-approval gate logic', () => {
  it('approvers / pending partition the list by approvedAt', () => {
    expect(approvers(parts()).map((p) => p.member.id)).toEqual(['bo']);
    expect(pending(parts()).map((p) => p.member.id)).toEqual(['priya']);
  });

  it('isHumanApproved is true once any one participant has approved (≥1 is enough)', () => {
    expect(isHumanApproved(parts())).toBe(true);
    expect(isHumanApproved([{ member: priya, addedBy: null, approvedAt: null }])).toBe(false);
    expect(isHumanApproved([])).toBe(false);
  });

  it('hasApproved is per-member', () => {
    expect(hasApproved(parts(), 'bo')).toBe(true);
    expect(hasApproved(parts(), 'priya')).toBe(false);
  });
});

describe('addParticipant', () => {
  it('adds a new member as pending', () => {
    const next = addParticipant([], bo, 'me');
    expect(next).toEqual([{ member: bo, addedBy: 'me', approvedAt: null }]);
  });

  it('is idempotent — mentioning an existing participant does not duplicate', () => {
    const start = addParticipant([], bo, 'me');
    const again = addParticipant(start, bo, 'someone-else');
    expect(again).toBe(start); // unchanged reference
    expect(again).toHaveLength(1);
  });
});

describe('recordApproval', () => {
  it('marks an existing participant approved at the given time', () => {
    const start: Participant[] = [{ member: priya, addedBy: 'me', approvedAt: null }];
    const next = recordApproval(start, priya, '2026-06-13T10:00:00.000Z');
    expect(next[0]!.approvedAt).toBe('2026-06-13T10:00:00.000Z');
  });

  it('self-joins a non-participant who approves', () => {
    const next = recordApproval([], me, '2026-06-13T10:00:00.000Z');
    expect(next).toEqual([{ member: me, addedBy: null, approvedAt: '2026-06-13T10:00:00.000Z' }]);
  });

  it('is a no-op if the member already approved (keeps original timestamp)', () => {
    const start: Participant[] = [{ member: bo, addedBy: null, approvedAt: '2026-06-13T09:00:00.000Z' }];
    const next = recordApproval(start, bo, '2026-06-13T11:00:00.000Z');
    expect(next[0]!.approvedAt).toBe('2026-06-13T09:00:00.000Z');
  });
});

describe('parseMentions', () => {
  const pool = [bo, priya, { id: 'bo2', displayName: 'Bo', avatarTint: '#000' }];

  it('resolves a single @-mention by display name', () => {
    expect(parseMentions('hey @Priya Nair can you check this', pool).map((m) => m.id)).toEqual(['priya']);
  });

  it('matches the longest name first so "@Bo Chen" is not also read as "@Bo"', () => {
    const hits = parseMentions('ping @Bo Chen please', pool).map((m) => m.id);
    expect(hits).toEqual(['bo']);
  });

  it('still resolves a bare "@Bo" to the short-named member', () => {
    expect(parseMentions('ping @Bo please', pool).map((m) => m.id)).toEqual(['bo2']);
  });

  it('resolves multiple distinct mentions', () => {
    const hits = parseMentions('@Bo Chen and @Priya Nair', pool).map((m) => m.id).sort();
    expect(hits).toEqual(['bo', 'priya']);
  });

  it('is case-insensitive and ignores unresolvable text', () => {
    expect(parseMentions('@bo chen and @Nobody Here', pool).map((m) => m.id)).toEqual(['bo']);
  });

  it('returns nothing when there are no mentions', () => {
    expect(parseMentions('just a plain comment', pool)).toEqual([]);
  });
});
