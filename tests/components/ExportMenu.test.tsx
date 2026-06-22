import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExportMenu, type ExportMenuArtifact } from '@/components/forge/export/ExportMenu';

const downloadGet = vi.fn(async (_url: string, _name: string) => {});
const downloadPost = vi.fn(async (_url: string, _body: unknown, _name: string) => ({
  included: ['exploration', 'spec'] as string[],
}));
vi.mock('@/components/forge/export/download', () => ({
  downloadGet: (...a: [string, string]) => downloadGet(...a),
  downloadPost: (...a: [string, unknown, string]) => downloadPost(...a),
}));

function artifacts(over: Partial<Record<string, Partial<ExportMenuArtifact>>> = {}): ExportMenuArtifact[] {
  const base: ExportMenuArtifact[] = [
    { kind: 'exploration', label: 'Exploration summary', ready: true, version: 1, lockedAudited: false },
    { kind: 'spec', label: 'Specification', ready: true, version: 1, lockedAudited: false },
    { kind: 'plan', label: 'Plan', ready: true, version: 1, lockedAudited: false },
    { kind: 'review', label: 'Review report', ready: false, version: null, lockedAudited: false },
  ];
  return base.map((a) => ({ ...a, ...(over[a.kind] ?? {}) }));
}

beforeEach(() => {
  downloadGet.mockClear();
  downloadPost.mockClear();
});

describe('ExportMenu (test 12, F10)', () => {
  it('renders four artifact rows + the Bundle row; pending row is dimmed + disabled', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-row-spec'));

    expect(screen.getByTestId('export-row-exploration')).toBeInTheDocument();
    expect(screen.getByTestId('export-row-spec')).toBeInTheDocument();
    expect(screen.getByTestId('export-row-plan')).toBeInTheDocument();
    expect(screen.getByTestId('export-bundle')).toBeInTheDocument();

    // pending review row is dimmed + aria-disabled
    const reviewRow = screen.getByTestId('export-row-review');
    expect(reviewRow).toHaveAttribute('aria-disabled', 'true');
    expect(reviewRow.className).toContain('opacity-[.55]');
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it("a ready row's .md/PDF actions are enabled", async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-row-spec'));

    const specRow = screen.getByTestId('export-row-spec');
    const buttons = specRow.querySelectorAll('button');
    buttons.forEach((b) => expect(b).not.toBeDisabled());
  });

  it('shows the derived locked · audited badge only for a locked+audited spec', async () => {
    render(
      <ExportMenu
        projectId="p1"
        fetchArtifacts={async () => artifacts({ spec: { lockedAudited: true } })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByText('locked · audited'));
    expect(screen.getByText('locked · audited')).toBeInTheDocument();
  });

  it('an unlocked spec shows ● ready, NOT locked · audited', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-row-spec'));
    expect(screen.queryByText('locked · audited')).toBeNull();
    expect(screen.getAllByText('ready').length).toBeGreaterThan(0);
  });

  it('clicking .md invokes the md route with the row kind', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-row-spec'));
    const specRow = screen.getByTestId('export-row-spec');
    fireEvent.click(specRow.querySelector('button')!); // .md is the first action button
    await waitFor(() => expect(downloadGet).toHaveBeenCalled());
    expect(downloadGet.mock.calls[0][0]).toContain('/export/md?artifact=spec');
  });

  it('the bundle toast enumerates included artifacts (test 14a, F11)', async () => {
    const onToast = vi.fn();
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} onToast={onToast} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-bundle'));
    fireEvent.click(screen.getByTestId('export-bundle'));
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    // included = exploration, spec → toast names specification, omits pending review
    expect(onToast.mock.calls[0][0]).toContain('exploration');
    expect(onToast.mock.calls[0][0]).toContain('specification');
    expect(onToast.mock.calls[0][0]).not.toContain('review');
  });
});
