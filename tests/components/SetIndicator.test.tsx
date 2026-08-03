import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetIndicator } from '@/components/patterns/form-panel';

/**
 * A stored credential's value is never sent to the browser, so set / not-set is all a
 * card can honestly show. It was written out four times — org Connections ×2, the team
 * git token, the team workspace path, and the Teams table's git column.
 */
describe('SetIndicator', () => {
  it('says set, in text and not by colour alone', () => {
    render(<SetIndicator set />);
    expect(screen.getByText('set')).toBeInTheDocument();
  });

  it('says not set', () => {
    render(<SetIndicator set={false} />);
    expect(screen.getByText('not set')).toBeInTheDocument();
  });

  it('distinguishes the two visually as well as textually', () => {
    const { container: on } = render(<SetIndicator set />);
    const { container: off } = render(<SetIndicator set={false} />);
    expect(on.firstElementChild!.className).not.toBe(off.firstElementChild!.className);
  });

  it('forwards a test id, which the connections cards rely on', () => {
    render(<SetIndicator set data-testid="mma-token-indicator" />);
    expect(screen.getByTestId('mma-token-indicator')).toBeInTheDocument();
  });
});
