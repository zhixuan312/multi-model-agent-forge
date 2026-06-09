import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StageExportButtons } from '@/components/forge/export/StageExportButtons';

const downloadGet = vi.fn(async (_url: string, _name: string) => {});
vi.mock('@/components/forge/export/download', () => ({
  downloadGet: (...a: [string, string]) => downloadGet(...a),
  downloadPost: vi.fn(async () => ({})),
}));

beforeEach(() => downloadGet.mockClear());

describe('StageExportButtons (test 14, F12 — same-engine convergence)', () => {
  it('Export .md hits /export/md with the stage own kind', async () => {
    render(<StageExportButtons projectId="p1" kind="plan" />);
    fireEvent.click(screen.getByRole('button', { name: /export \.md/i }));
    await waitFor(() => expect(downloadGet).toHaveBeenCalled());
    expect(downloadGet.mock.calls[0][0]).toContain('/export/md?artifact=plan');
  });

  it('Export PDF opens the ExportPdfDialog scoped to the stage kind', async () => {
    render(<StageExportButtons projectId="p1" kind="spec" />);
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }));
    await waitFor(() => screen.getByTestId('export-pdf-dialog'));
    expect(screen.getByTestId('export-pdf-dialog')).toHaveAttribute('aria-label', 'Export spec as PDF');
  });
});
