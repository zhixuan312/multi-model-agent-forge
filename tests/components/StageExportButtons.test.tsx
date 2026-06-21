import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StageExportButtons } from '@/components/forge/export/StageExportButtons';

const downloadGet = vi.fn(async (_url: string, _name: string) => {});
const downloadPost = vi.fn(async (_url: string, _body: unknown, _name: string) => ({}));
vi.mock('@/components/forge/export/download', () => ({
  downloadGet: (...a: [string, string]) => downloadGet(...a),
  downloadPost: (...a: [string, unknown, string]) => downloadPost(...a),
}));

beforeEach(() => { downloadGet.mockClear(); downloadPost.mockClear(); });

describe('StageExportButtons', () => {
  it('.md button downloads the artifact markdown', async () => {
    render(<StageExportButtons projectId="p1" kind="plan" />);
    fireEvent.click(screen.getByRole('button', { name: /\.md/i }));
    await waitFor(() => expect(downloadGet).toHaveBeenCalled());
    expect(downloadGet.mock.calls[0][0]).toContain('/export/md?artifact=plan');
  });

  it('PDF button triggers direct PDF download', async () => {
    render(<StageExportButtons projectId="p1" kind="spec" />);
    fireEvent.click(screen.getByRole('button', { name: /pdf/i }));
    await waitFor(() => expect(downloadPost).toHaveBeenCalled());
    expect(downloadPost.mock.calls[0][0]).toContain('/export/pdf');
  });
});
