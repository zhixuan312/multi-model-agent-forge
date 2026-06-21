import type { MemberRef, NotificationItem, UnitCollab } from '@/collab/types';
import type { ComponentKind } from '@/db/enums';

/**
 * Mock collaborative-approval data so the Spec-craft co-approval flow is walkable
 * without a DB: the @-mention pool, one section pre-seeded mid-group-chat, and a
 * notification feed for the bell. Mutations live in client React state (like the
 * Craft Q&A answers), so nothing here persists — a reload restores the seed,
 * which is exactly right for a walk-through.
 */

/** Matches `MOCK_MEMBER` in current-member.ts — the signed-in "you". */
export const MOCK_ME_ID = '5bf0cfe8-ad4d-47fd-903a-74fa5d2c6fea';

const BO: MemberRef = { id: 'mem-bo', displayName: 'Bo Chen', avatarTint: '#355a74' };
const PRIYA: MemberRef = { id: 'mem-05', displayName: 'Priya Nair', avatarTint: '#b23a48' };
const DEVON: MemberRef = { id: 'mem-02', displayName: 'Devon Park', avatarTint: '#4e7350' };
const AISHA: MemberRef = { id: 'mem-03', displayName: 'Aisha Rahman', avatarTint: '#a9761a' };
const LEON: MemberRef = { id: 'mem-04', displayName: 'Leon Whitaker', avatarTint: '#7a5230' };

/** People who can be @-mentioned into a section. Includes a literal "Bo" so the
 *  demo's "@Bo" reads naturally. */
export const MOCK_PROJECT_MEMBERS: MemberRef[] = [BO, PRIYA, DEVON, AISHA, LEON];

/**
 * Per-component-kind seed. `proposed_design` opens already mid-group-chat: Bo was
 * pulled in and approved, Priya is pending — so the panel shows "approved by Bo ·
 * 1 pending" before you touch anything, and the soft-nudge has something to warn
 * about.
 */
export const MOCK_CRAFT_COLLAB: Partial<Record<string, UnitCollab>> = {
  technical_design: {
    participants: [
      { member: BO, addedBy: MOCK_ME_ID, approvedAt: '2026-06-13T09:40:00.000Z' },
      { member: PRIYA, addedBy: MOCK_ME_ID, approvedAt: null },
    ],
    discussion: [
      {
        id: 'd-pd-1',
        authorId: BO.id,
        body: 'Pulled in on the worktree isolation — running the reviewer on the opposite tier is the right call. Approving from my side. Shout if the Phase-2 budget model changes.',
        approval: true,
      },
    ],
  },
};

export function mockProjectMembers(): MemberRef[] {
  return MOCK_PROJECT_MEMBERS;
}

export function mockCraftCollab(): Partial<Record<ComponentKind, UnitCollab>> {
  return MOCK_CRAFT_COLLAB;
}

/** Notification feed for the bell (newest first). */
export function mockNotifications(): NotificationItem[] {
  const href = '/projects/mock-project-01/spec';
  const projectName = 'Unified Task API';
  return [
    {
      id: 'n-mention-pd',
      kind: 'section_mention',
      actor: BO,
      projectId: 'mock-project-01',
      projectName,
      unitLabel: 'Proposed Design',
      href,
      createdAt: '2026-06-13T09:41:00.000Z',
      read: false,
    },
    {
      id: 'n-approve-pd',
      kind: 'section_approved',
      actor: BO,
      projectId: 'mock-project-01',
      projectName,
      unitLabel: 'Proposed Design',
      href,
      createdAt: '2026-06-13T09:40:00.000Z',
      read: false,
    },
    {
      id: 'n-mention-cs',
      kind: 'section_mention',
      actor: PRIYA,
      projectId: 'mock-project-01',
      projectName,
      unitLabel: 'Context & Scope',
      href,
      createdAt: '2026-06-12T16:05:00.000Z',
      read: true,
    },
  ];
}
