import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewProjectForm } from '../../app/(app)/projects/new/NewProjectForm';
import type { RepoPickerRepo } from '@/components/forge/RepoPicker';

// Mock the server action: first submit returns an empty-name field error so the
// a11y error wiring (aria-describedby + aria-live) can be asserted in jsdom.
vi.mock('../../app/(app)/projects/new/actions', () => ({
  createProjectAction: vi.fn(async () => ({
    error: { field: 'name', message: 'Project name is required.' },
  })),
}));

const repos: RepoPickerRepo[] = [
  { id: '1', name: 'eval-core', kind: 'service', tags: ['eval'], status: 'cloned' },
];

describe('NewProjectForm a11y', () => {
  it('every control carries an accessible label; visibility is a labelled radio group', () => {
    render(<NewProjectForm repos={repos} />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Visibility' })).toBeInTheDocument();
    expect(screen.getByLabelText('Select repository eval-core')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    // public is the default selected
    expect((radios.find((r) => (r as HTMLInputElement).value === 'public') as HTMLInputElement).checked).toBe(true);
  });

  it('a failed submit associates the field error via aria-describedby and announces it in an aria-live region', async () => {
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    const error = await waitFor(() => screen.getByText('Project name is required.'));
    expect(error).toHaveAttribute('id', 'name-error');
    // the name input points at the error via aria-describedby
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-describedby', 'name-error');
    // the error lives inside an aria-live region
    const live = error.closest('[aria-live="polite"]');
    expect(live).not.toBeNull();
  });
});
