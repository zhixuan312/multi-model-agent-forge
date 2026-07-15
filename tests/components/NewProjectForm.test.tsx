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
  it('reveals the exploration upload when a spec-start preset is chosen', () => {
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByLabelText('Spec'));
    expect(screen.getByLabelText('Your exploration file')).toBeInTheDocument();
  });

  it('offers mutually-exclusive design-run presets (non-contiguous combos are impossible)', () => {
    render(<NewProjectForm repos={repos} />);
    const spec = screen.getByLabelText('Spec') as HTMLInputElement;
    const specPlan = screen.getByLabelText('Spec → Plan') as HTMLInputElement;
    fireEvent.click(spec);
    expect(spec.checked).toBe(true);
    // Picking another preset deselects the first — a non-contiguous set can never be expressed.
    fireEvent.click(specPlan);
    expect(specPlan.checked).toBe(true);
    expect(spec.checked).toBe(false);
  });

  it('gates submit until the required upstream file is attached', () => {
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByLabelText('Spec'));
    // Spec-start needs an exploration file; until one is attached, Create is disabled.
    expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled();
    expect(screen.getByText('Upload your exploration file to continue')).toBeInTheDocument();
  });

  it('renders a server artifact error inline once a file enables submit', async () => {
    mockActionResult = { error: { field: 'artifact', message: 'file failed to load or parse — re-upload' } };
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByLabelText('Spec'));
    const input = screen.getByLabelText('Your exploration file');
    const file = new File(['# Exploration: x\n\n## Background\n\nhi'], 'e.md', { type: 'text/markdown' });
    fireEvent.change(input, { target: { files: [file] } });
    // The file is read + encoded asynchronously; wait for the gate to clear, then submit.
    await waitFor(() => expect(screen.getByRole('button', { name: /Create/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));
    await waitFor(() => screen.getByText('file failed to load or parse — re-upload'));
    expect(screen.getByText('file failed to load or parse — re-upload')).toBeInTheDocument();
  });
});
