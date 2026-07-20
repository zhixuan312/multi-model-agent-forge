import { render, screen } from '@testing-library/react';
import type { AuthedMember } from '@/auth/auth-provider';

const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});
const notFound = vi.fn(() => {
  throw new Error('notFound');
});

let mockMember: AuthedMember | null = null;

vi.mock('next/navigation', () => ({ redirect, notFound }));
vi.mock('@/auth/current-member', () => ({ currentMember: async () => mockMember }));
// getComponentGovernanceView is now a pure static builder over the code registry — no mock.
vi.mock('../../app/(app)/settings/components/SlotEditor', () => ({
  SlotEditor: ({ slot }: { slot: { slotId: string } }) => <div>Editor:{slot.slotId}</div>,
}));

const indexPage = await import('../../app/(app)/settings/components/page');
const slotPage = await import('../../app/(app)/settings/components/[slotId]/page');

const admin: AuthedMember = { id: 'a1', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', role: 'org_admin', teamId: null };
const member: AuthedMember = { id: 'm1', username: 'member', displayName: 'Member', avatarTint: '#9a6b4f', role: 'member', teamId: 't1' };

describe('/settings/components developer-mode pages', () => {
  beforeEach(() => {
    redirect.mockClear();
    notFound.mockClear();
    mockMember = null;
  });

  it('index redirects a non-org-admin to /', async () => {
    mockMember = member;
    await expect(indexPage.default()).rejects.toThrow('redirect:/');
  });

  it('index lands an org-admin on the first governed slot page', async () => {
    mockMember = admin;
    await expect(indexPage.default()).rejects.toThrow('redirect:/settings/components/background');
  });

  it('slot page redirects a non-org-admin to /', async () => {
    mockMember = member;
    await expect(slotPage.default({ params: Promise.resolve({ slotId: 'stageFlow' }) })).rejects.toThrow('redirect:/');
  });

  it('a slot WITH variants redirects to its first variant (no stacked overview)', async () => {
    mockMember = admin;
    await expect(slotPage.default({ params: Promise.resolve({ slotId: 'appShell' }) })).rejects.toThrow(
      'redirect:/settings/components/appShell/anatomy',
    );
  });

  it('slot page 404s an unknown slot id', async () => {
    mockMember = admin;
    await expect(slotPage.default({ params: Promise.resolve({ slotId: 'not-a-slot' }) })).rejects.toThrow('notFound');
  });

  it('slot page renders the single-component editor for a valid slot', async () => {
    mockMember = admin;
    const ui = await slotPage.default({ params: Promise.resolve({ slotId: 'background' }) });
    render(ui);
    expect(screen.getByText('Editor:background')).toBeInTheDocument();
  });
});
