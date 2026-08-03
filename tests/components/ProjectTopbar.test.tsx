import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTopbar } from '@/components/forge/ProjectTopbar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe('ProjectTopbar', () => {
  it('renders the phase kicker reflecting project.phase and a disabled Export stub', () => {
    render(<ProjectTopbar projectName="Evaluation indicator #11" phase="design" />);
    expect(screen.getByText('Evaluation indicator #11')).toBeInTheDocument();
    expect(screen.getByTestId('phase-badge')).toHaveTextContent('Design');
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeDisabled();
  });

  it('kicker reflects a Build-phase project', () => {
    render(<ProjectTopbar projectName="Payments" phase="build" />);
    expect(screen.getByTestId('phase-badge')).toHaveTextContent('Build');
  });

  it('renders presence avatars when supplied (static stub)', () => {
    render(
      <ProjectTopbar
        projectName="Evaluation indicator #11"
        phase="design"
        presence={[
          { memberId: '1', displayName: 'Maya Adeyemi', avatarTint: '#6A6F8C' },
          { memberId: '2', displayName: 'Devon Vance', avatarTint: '#5E7C6B' },
        ]}
      />,
    );
    const presence = screen.getByTestId('presence');
    expect(presence.children).toHaveLength(2);
    expect(presence).toHaveTextContent('MA');
    expect(presence).toHaveTextContent('DV');
  });

  it('renders the no-project placeholder when no name', () => {
    render(<ProjectTopbar />);
    expect(screen.getByText('No active project')).toBeInTheDocument();
  });

  it('exposes an owner-only archive action inside the overflow menu', async () => {
    render(
      <ProjectTopbar
        projectId="proj-1"
        projectName="Payments"
        phase="build"
        canArchive
        archived={false}
      />,
    );
    // Collapsed by default — the archive action lives behind the ⋯ menu.
    expect(screen.queryByRole('menuitem', { name: 'Archive project' })).not.toBeInTheDocument();
    // The menu is Radix now, which opens on pointer events rather than a bare click.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Project actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Archive project' })).toBeInTheDocument();
  });

  it('switches the label when the project is already archived', async () => {
    render(
      <ProjectTopbar
        projectId="proj-1"
        projectName="Payments"
        phase="build"
        canArchive
        archived
      />,
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Project actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Unarchive project' })).toBeInTheDocument();
  });

  it('offers no overflow menu when the actor can neither archive nor view activity', () => {
    render(<ProjectTopbar projectId="proj-1" projectName="Payments" phase="build" />);
    expect(screen.queryByRole('button', { name: 'Project actions' })).not.toBeInTheDocument();
  });
});
