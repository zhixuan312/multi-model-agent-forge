import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
    { kind: 'plan', label: 'Plan', ready: false, version: null, lockedAudited: false },
  ];
  return base.map((a) => ({ ...a, ...(over[a.kind] ?? {}) }));
}

beforeEach(() => {
  downloadGet.mockClear();
  downloadPost.mockClear();
});

describe('ExportMenu (test 12, F10)', () => {
  it('renders the three artifact rows + the Bundle row; pending row is dimmed + disabled', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-row-spec'));

    // journal is no longer an exportable artifact — only exploration/spec/plan.
    expect(screen.getByTestId('export-row-exploration')).toBeInTheDocument();
    expect(screen.getByTestId('export-row-spec')).toBeInTheDocument();
    expect(screen.getByTestId('export-row-plan')).toBeInTheDocument();
    expect(screen.queryByTestId('export-row-journal')).toBeNull();
    expect(screen.getByTestId('export-bundle')).toBeInTheDocument();

    // the pending row (plan, not-ready) is dimmed + aria-disabled
    const pendingRow = screen.getByTestId('export-row-plan');
    expect(pendingRow).toHaveAttribute('aria-disabled', 'true');
    expect(pendingRow.className).toContain('opacity-[.55]');
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it("a ready row's .md/PDF actions are enabled", async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-row-spec'));

    const specRow = screen.getByTestId('export-row-spec');
    const buttons = specRow.querySelectorAll('button');
    // Assert the count FIRST: `forEach` over an empty NodeList runs no assertion at all,
    // so without this the test would still pass if the row rendered no actions.
    expect(buttons).toHaveLength(2); // .md and PDF
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
    // included = exploration, spec → toast names specification, omits pending journal
    expect(onToast.mock.calls[0][0]).toContain('exploration');
    expect(onToast.mock.calls[0][0]).toContain('specification');
    expect(onToast.mock.calls[0][0]).not.toContain('journal');
  });

  it('surfaces an error when artifacts fail to load — not a silent empty menu (QA E#5)', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => { throw new Error('Couldn\u2019t load exportable artifacts.'); }} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(await screen.findByText(/Couldn\u2019t load exportable artifacts/)).toBeInTheDocument();
  });

  it('disables export while one is in flight — a re-click cannot fire a duplicate (QA E#2)', async () => {
    let resolve!: (v: { included: string[] }) => void;
    downloadPost.mockImplementationOnce(() => new Promise((r) => { resolve = r as never; }));
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-bundle'));
    const bundle = screen.getByTestId('export-bundle');
    fireEvent.click(bundle);
    await waitFor(() => expect(bundle).toBeDisabled());
    fireEvent.click(bundle); // ignored while busy
    expect(downloadPost).toHaveBeenCalledTimes(1);
    resolve({ included: ['spec'] });
  });
});

/**
 * The panel is hand-rolled (there is no Radix Popover dependency), so the behaviours a
 * library would supply have to be asserted here. Escape was missing entirely: the panel
 * could be opened from the keyboard and then dismissed only with a mouse.
 */
describe('ExportMenu keyboard + semantics', () => {
  it('closes on Escape and returns focus to the trigger', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    const trigger = screen.getByRole('button', { name: /export/i });
    fireEvent.click(trigger);
    await waitFor(() => screen.getByTestId('export-menu'));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('export-menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('is a group, not a menu — each row holds two independent actions', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => screen.getByTestId('export-menu'));

    // A menuitem carries one action; these rows carry `.md` AND PDF, so `role="menu"`
    // described something the markup cannot be.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('group', { name: 'Export artifacts' })).toBeInTheDocument();
    expect(within(screen.getByTestId('export-row-spec')).getAllByRole('button')).toHaveLength(2);
  });

  it('points the trigger at the panel it opens', async () => {
    render(<ExportMenu projectId="p1" fetchArtifacts={async () => artifacts()} />);
    const trigger = screen.getByRole('button', { name: /export/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    await waitFor(() => screen.getByTestId('export-menu'));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('export-menu')).toHaveAttribute('id', trigger.getAttribute('aria-controls'));
  });
});
