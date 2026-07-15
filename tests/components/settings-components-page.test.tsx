import { render, screen } from '@testing-library/react';
import type { AuthedMember } from '@/auth/auth-provider';

const redirect = vi.fn(() => {
  throw new Error('redirected');
});

let mockMember: AuthedMember | null = null;

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/auth/current-member', () => ({ currentMember: async () => mockMember }));
vi.mock('@/config/component-governance-core', () => ({
  getComponentGovernanceView: vi.fn(async () => ({ slots: [] })),
}));
vi.mock('../../app/(app)/settings/components/ComponentsGovernancePanel', () => ({
  ComponentsGovernancePanel: () => <div>Panel body</div>,
}));

const page = await import('../../app/(app)/settings/components/page');

describe('/settings/components page entry', () => {
  beforeEach(() => {
    redirect.mockClear();
    mockMember = null;
  });

  it('extends the org settings tab bar with Components', async () => {
    const { OrgSettingsTabs } = await import('@/components/forge/OrgSettingsTabs');
    render(<OrgSettingsTabs active="components" />);
    expect(screen.getByRole('tab', { name: 'Components' })).toHaveAttribute('href', '/settings/components');
  });

  it('redirects non-org-admin callers to /', async () => {
    mockMember = { id: 'm1', username: 'member', displayName: 'Member', avatarTint: '#9a6b4f', role: 'member', teamId: 'team-1' };
    await expect(page.default()).rejects.toThrow('redirected');
    expect(redirect).toHaveBeenCalledWith('/');
  });
});
