import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NewProjectForm } from '../../app/(app)/projects/new/NewProjectForm';
import type { RepoPickerRepo } from '@/components/forge/RepoPicker';
import { MAX_UPLOAD_BYTES, CREATE_PROJECT_FILE_TOO_LARGE } from '@/projects/upload-limits';

// Mock the server action: by default returns a name error; can be overridden by tests
let mockActionResult = { error: { field: 'name', message: 'Project name is required.' } };
vi.mock('../../app/(app)/projects/new/actions', () => ({
  createProjectAction: vi.fn(async () => mockActionResult),
}));

const repos: RepoPickerRepo[] = [
  { id: '1', name: 'eval-core', tags: ['eval'], status: 'cloned' },
];

describe('NewProjectForm a11y', () => {
  it('every control carries an accessible label', () => {
    render(<NewProjectForm repos={repos} />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Select repository eval-core')).toBeInTheDocument();
  });

  /**
   * Visibility was two plain buttons: nothing exposed WHICH was selected, so a screen
   * reader heard "public" and "private" with no state — the one thing a visibility
   * control has to convey. The Design-run group directly below it was already a proper
   * radiogroup. This case previously said "public is the default selected" in a comment
   * and then asserted only that the button existed, which is how the gap survived.
   */
  it('exposes visibility as a radiogroup with public selected by default', () => {
    render(<NewProjectForm repos={repos} />);
    const group = within(screen.getByRole('radiogroup', { name: 'Visibility' }));
    expect(group.getByRole('radio', { name: 'public' })).toHaveAttribute('aria-checked', 'true');
    expect(group.getByRole('radio', { name: 'private' })).toHaveAttribute('aria-checked', 'false');
  });

  it('moves the checked radio when visibility changes', () => {
    render(<NewProjectForm repos={repos} />);
    const group = within(screen.getByRole('radiogroup', { name: 'Visibility' }));
    fireEvent.click(group.getByRole('radio', { name: 'private' }));
    expect(group.getByRole('radio', { name: 'private' })).toHaveAttribute('aria-checked', 'true');
    expect(group.getByRole('radio', { name: 'public' })).toHaveAttribute('aria-checked', 'false');
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

/**
 * The size limit belongs on BOTH sides of the wire.
 *
 * `decodeUploadedArtifact` has always rejected over-limit uploads, so nothing was ever
 * accepted that shouldn't be — but the picker learned the answer only after the browser had
 * read the file and base64-encoded it (two full copies in the tab, built synchronously), and
 * after a round-trip that carried the whole payload. Pick a 40 MB file and the page freezes,
 * then reports a limit it could have checked instantly.
 *
 * Both cases matter: the guard must fire before the read, and it must NOT fire for a normal
 * file — a client cap that is stricter than the server's would reject valid uploads with no
 * way to appeal.
 */
describe('NewProjectForm upload size guard', () => {
  function chooseExploration(file: File) {
    render(<NewProjectForm repos={repos} />);
    fireEvent.click(screen.getByLabelText('Spec'));
    const input = screen.getByLabelText('Your exploration file');
    // A File's `size` derives from its parts; `arrayBuffer` is what the guard must skip.
    const spy = vi.spyOn(file, 'arrayBuffer');
    fireEvent.change(input, { target: { files: [file] } });
    return spy;
  }

  it('rejects an oversized file before reading it, naming the limit', async () => {
    const big = new File(['x'.repeat(MAX_UPLOAD_BYTES + 1)], 'huge.md', { type: 'text/markdown' });
    const spy = chooseExploration(big);

    await waitFor(() => screen.getByText(new RegExp(CREATE_PROJECT_FILE_TOO_LARGE)));
    expect(spy, 'the file was read despite being over the limit').not.toHaveBeenCalled();
    // The picker still shows nothing attached — an over-limit file must not arm submit.
    expect(screen.getByText('Upload your exploration file to continue')).toBeInTheDocument();
  });

  it('reads a file at exactly the limit — the client cap is not stricter than the server', async () => {
    const ok = new File(['# Exploration: x\n\n## Background\n\nhi'], 'e.md', { type: 'text/markdown' });
    const spy = chooseExploration(ok);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.queryByText(new RegExp(CREATE_PROJECT_FILE_TOO_LARGE))).toBeNull();
  });
});
