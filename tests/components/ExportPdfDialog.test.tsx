import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportPdfDialog } from '@/components/forge/export/ExportPdfDialog';

const downloadPost = vi.fn(async (_url: string, _body: unknown, _name: string) => ({}));
vi.mock('@/components/forge/export/download', () => ({
  downloadPost: (...a: [string, unknown, string]) => downloadPost(...a),
}));

beforeEach(() => downloadPost.mockClear());

describe('ExportPdfDialog', () => {
  it('renders the mermaid toggle and Export PDF button', () => {
    render(<ExportPdfDialog projectId="p1" kind="spec" open onClose={() => {}} />);
    expect(screen.getByLabelText('Mermaid flow charts as diagrams')).toBeChecked();
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeEnabled();
  });

  it('posts artifact + mermaidAsDiagram on Export', async () => {
    render(<ExportPdfDialog projectId="p1" kind="spec" open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }));
    await waitFor(() => expect(downloadPost).toHaveBeenCalled());
    const body = downloadPost.mock.calls[0][1] as { artifact: string; mermaidAsDiagram: boolean };
    expect(body.artifact).toBe('spec');
    expect(body.mermaidAsDiagram).toBe(true);
  });
});
