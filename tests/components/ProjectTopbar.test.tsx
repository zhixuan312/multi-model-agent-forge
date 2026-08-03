import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTopbar } from '@/components/forge/ProjectTopbar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * The topbar has ONE caller — the project layout — which always has a project. Three of these
 * tests used to exercise states it cannot produce: a bare `<ProjectTopbar />` for the "No
 * active project" placeholder, a `presence` avatar row with no data source anywhere in the
 * app, and a disabled Export stub reachable only through a prop nothing passed. They were the
 * only thing keeping that code alive.
 *
 * A test is not a caller. What is asserted here is what the layout can actually render.
 */
describe('ProjectTopbar', () => {
  it('names the project and reflects its phase', () => {
    render(<ProjectTopbar projectId="p1" projectName="Evaluation indicator #11" phase="design" />);
    expect(screen.getByText('Evaluation indicator #11')).toBeInTheDocument();
    expect(screen.getByTestId('phase-badge')).toHaveTextContent('Design');
  });

  it('kicker reflects a Build-phase project', () => {
    render(<ProjectTopbar projectId="p1" projectName="Payments" phase="build" />);
    expect(screen.getByTestId('phase-badge')).toHaveTextContent('Build');
  });

  it('offers Export, since there is always a project here', () => {
    render(<ProjectTopbar projectId="p1" projectName="Payments" phase="build" />);
    expect(screen.getByRole('button', { name: /export/i })).toBeEnabled();
  });

  it('links back to the projects list', () => {
    render(<ProjectTopbar projectId="p1" projectName="Payments" phase="build" />);
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
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
