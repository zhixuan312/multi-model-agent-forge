import { render, screen, fireEvent } from '@testing-library/react';
import { BrainDumpComposer, pickRecorderMime } from '@/components/forge/BrainDumpComposer';
import type { AttachmentView } from '@/exploration/attachments';

const noop = () => {};
const baseProps = {
  value: '',
  onChange: noop,
  attachments: [] as AttachmentView[],
  voiceEnabled: true,
  recording: false,
  busy: false,
  error: null as string | null,
  onAnalyze: noop,
  onToggleRecord: noop,
  onAddLink: noop,
  onAddFile: noop,
  onRemoveAttachment: noop,
};

describe('pickRecorderMime (F10 — Safari fallback)', () => {
  it('selects audio/webm;codecs=opus when supported', () => {
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus');
  });
  it('falls back to audio/mp4 when webm is unsupported (Safari)', () => {
    expect(pickRecorderMime(() => false)).toBe('audio/mp4');
  });
});

describe('BrainDumpComposer (F19 controls)', () => {
  it('the voice record button exposes aria-pressed reflecting the recording state', () => {
    const { rerender } = render(<BrainDumpComposer {...baseProps} recording={false} />);
    expect(screen.getByRole('button', { name: /record voice/i })).toHaveAttribute('aria-pressed', 'false');
    rerender(<BrainDumpComposer {...baseProps} recording={true} />);
    expect(screen.getByRole('button', { name: /record voice/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('attach link/file controls expose aria-labels', () => {
    render(<BrainDumpComposer {...baseProps} />);
    expect(screen.getByRole('button', { name: /attach link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attach file/i })).toBeInTheDocument();
  });

  it('hides the voice control when voice is disabled', () => {
    render(<BrainDumpComposer {...baseProps} voiceEnabled={false} />);
    expect(screen.queryByRole('button', { name: /record voice/i })).not.toBeInTheDocument();
  });

  it('renders attachment chips with a remove button', () => {
    const onRemove = vi.fn();
    render(
      <BrainDumpComposer
        {...baseProps}
        attachments={[{ id: 'a1', kind: 'link', label: 'Docs', payload: { url: 'https://x' } }]}
        onRemoveAttachment={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove docs/i }));
    expect(onRemove).toHaveBeenCalledWith('a1');
  });

  it('fires Analyze sources', () => {
    const onAnalyze = vi.fn();
    render(<BrainDumpComposer {...baseProps} onAnalyze={onAnalyze} />);
    fireEvent.click(screen.getByRole('button', { name: /analyze sources/i }));
    expect(onAnalyze).toHaveBeenCalled();
  });
});
