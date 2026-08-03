import { render, screen } from '@testing-library/react';
import { Banner } from '@/components/ui/banner';

describe('Banner', () => {
  it('announces a danger banner assertively', () => {
    // Same split Toast makes. A failure that waits behind whatever is already being read
    // is announced too late to act on.
    render(<Banner variant="danger" title="Deploy failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Deploy failed');
  });

  it('announces the non-danger variants politely', () => {
    for (const variant of ['info', 'success', 'warning'] as const) {
      const { unmount } = render(<Banner variant={variant} title={`a ${variant}`} />);
      expect(screen.getByRole('status')).toHaveTextContent(`a ${variant}`);
      unmount();
    }
  });

  it('defaults to info, and therefore to polite', () => {
    render(<Banner title="just so you know" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the dismiss control only when a handler is given, and names it', () => {
    const { unmount } = render(<Banner title="t" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    unmount();
    render(<Banner title="t" onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});
