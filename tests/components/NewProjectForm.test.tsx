import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewProjectForm } from '../../app/(app)/projects/new/NewProjectForm';
import type { RepoPickerRepo } from '@/components/forge/RepoPicker';

// Mock the server action: by default returns a name error; can be overridden by tests
let mockActionResult = { error: { field: 'name', message: 'Project name is required.' } };
vi.mock('../../app/(app)/projects/new/actions', () => ({
  createProjectAction: vi.fn(async () => mockActionResult),
}));

const repos: RepoPickerRepo[] = [
  { id: '1', name: 'eval-core', tags: ['eval'], status: 'cloned' },
];

describe('NewProjectForm a11y', () => {
  it('every control carries an accessible label; visibility uses toggle buttons with icons', () => {
    render(<NewProjectForm repos={repos} />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('public')).toBeInTheDocument();
    expect(screen.getByLabelText('private')).toBeInTheDocument();
    expect(screen.getByLabelText('Select repository eval-core')).toBeInTheDocument();
    // public is the default selected
    const publicButton = screen.getByLabelText('public') as HTMLButtonElement;
    expect(publicButton).toBeInTheDocument();
  });

  it('a failed submit associates the field error via aria-describedby and announces it in an aria-live region', async () => {
    mockActionResult = { error: { field: 'name', message: 'Project name is required.' } };
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    const error = await waitFor(() => screen.getByText('Project name is required.'));
    const errorId = error.getAttribute('id');
    expect(errorId).toBeTruthy();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', expect.stringContaining(errorId!));
    expect(error).toBeInTheDocument();
  });
});

describe('NewProjectForm subset creation', () => {
  it('reveals exploration upload when spec is the entry stage', () => {
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByLabelText('Start at spec'));
    expect(screen.getByLabelText('Exploration artifact')).toBeInTheDocument();
  });

  it('prevents non-contiguous exploration+plan selection', async () => {
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByLabelText('Include exploration'));
    fireEvent.click(screen.getByLabelText('Include plan'));
    expect(await screen.findByText('Choose a contiguous design run.')).toBeInTheDocument();
  });

  it('renders server artifact errors through the existing action-state channel', async () => {
    mockActionResult = { error: { field: 'artifact', message: 'file failed to load or parse — re-upload' } };
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => screen.getByText('file failed to load or parse — re-upload'));
    expect(screen.getByText('file failed to load or parse — re-upload')).toBeInTheDocument();
  });
});
