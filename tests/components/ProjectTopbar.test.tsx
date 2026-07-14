import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('shows an owner-only archive action with an accessible name', () => {
    render(
      <ProjectTopbar
        projectId="proj-1"
        projectName="Payments"
        phase="build"
        canArchive
        archived={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Archive project' })).toBeInTheDocument();
  });

  it('switches the label when the project is already archived', () => {
    render(
      <ProjectTopbar
        projectId="proj-1"
        projectName="Payments"
        phase="build"
        canArchive
        archived
      />,
    );
    expect(screen.getByRole('button', { name: 'Unarchive project' })).toBeInTheDocument();
  });
});
