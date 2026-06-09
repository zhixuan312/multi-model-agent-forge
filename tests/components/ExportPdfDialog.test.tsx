import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExportPdfDialog } from '@/components/forge/export/ExportPdfDialog';

const downloadPost = vi.fn(async (_url: string, _body: unknown, _name: string) => ({}));
vi.mock('@/components/forge/export/download', () => ({
  downloadPost: (...a: [string, unknown, string]) => downloadPost(...a),
}));

const SECTIONS = [
  { nn: '01', title: 'Context' },
  { nn: '03', title: 'Technical design' },
];

beforeEach(() => downloadPost.mockClear());

describe('ExportPdfDialog (test 13, F13/F30)', () => {
  it('for a spec, renders one checkbox per {NN,title} (value=NN, label=title)', async () => {
    render(
      <ExportPdfDialog projectId="p1" kind="spec" open onClose={() => {}} fetchSections={async () => SECTIONS} />,
    );
    await waitFor(() => screen.getByLabelText('Context'));
    const ctx = screen.getByLabelText('Context') as HTMLInputElement;
    const tech = screen.getByLabelText('Technical design') as HTMLInputElement;
    expect(ctx.value).toBe('01');
    expect(tech.value).toBe('03');
    // all checked by default
    expect(ctx.checked).toBe(true);
    expect(tech.checked).toBe(true);
    // mermaid toggle present
    expect(screen.getByLabelText('Mermaid flow charts as diagrams')).toBeInTheDocument();
  });

  it('for a non-spec artifact, renders NO checkbox list and makes NO sections call', async () => {
    const fetchSections = vi.fn(async () => SECTIONS);
    render(
      <ExportPdfDialog projectId="p1" kind="plan" open onClose={() => {}} fetchSections={fetchSections} />,
    );
    expect(screen.queryByTestId('component-list')).toBeNull();
    expect(fetchSections).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mermaid flow charts as diagrams')).toBeInTheDocument();
  });

  it('Export PDF is disabled when zero components are checked (client guard for 422)', async () => {
    render(
      <ExportPdfDialog projectId="p1" kind="spec" open onClose={() => {}} fetchSections={async () => SECTIONS} />,
    );
    await waitFor(() => screen.getByLabelText('Context'));
    // uncheck both
    fireEvent.click(screen.getByLabelText('Context'));
    fireEvent.click(screen.getByLabelText('Technical design'));
    const exportBtn = screen.getByRole('button', { name: /export pdf/i });
    expect(exportBtn).toBeDisabled();
  });

  it('posts the selected NN keys + mermaid flag on Export', async () => {
    render(
      <ExportPdfDialog projectId="p1" kind="spec" open onClose={() => {}} fetchSections={async () => SECTIONS} />,
    );
    await waitFor(() => screen.getByLabelText('Context'));
    fireEvent.click(screen.getByLabelText('Technical design')); // drop 03 → only 01 stays
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }));
    await waitFor(() => expect(downloadPost).toHaveBeenCalled());
    const body = downloadPost.mock.calls[0][1] as {
      artifact: string;
      includeComponents: string[];
      mermaidAsDiagram: boolean;
    };
    expect(body.artifact).toBe('spec');
    expect(body.includeComponents).toEqual(['01']);
    expect(body.mermaidAsDiagram).toBe(true);
  });
});
