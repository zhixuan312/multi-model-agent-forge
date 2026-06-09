import { render, screen } from '@testing-library/react';
import { ProjectTopbar } from '@/components/forge/ProjectTopbar';

describe('ProjectTopbar', () => {
  it('renders the placeholder (no project) with an inert Export slot', () => {
    render(<ProjectTopbar />);
    expect(screen.getByTestId('project-topbar')).toBeInTheDocument();
    expect(screen.getByText('No active project')).toBeInTheDocument();
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeDisabled();
  });

  it('renders presence avatars when supplied', () => {
    render(
      <ProjectTopbar
        projectName="Evaluation indicator #11"
        presence={[
          { memberId: '1', displayName: 'Maya Adeyemi', avatarTint: '#6A6F8C' },
          { memberId: '2', displayName: 'Devon Vance', avatarTint: '#5E7C6B' },
        ]}
      />,
    );
    expect(screen.getByText('Evaluation indicator #11')).toBeInTheDocument();
    const presence = screen.getByTestId('presence');
    expect(presence.children).toHaveLength(2);
    expect(presence).toHaveTextContent('MA');
    expect(presence).toHaveTextContent('DV');
  });
});
