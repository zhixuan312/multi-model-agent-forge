// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Check } from 'lucide-react';

/**
 * `loading` was carried by a spinner glyph and nothing else. The glyph is `aria-hidden` —
 * correctly, it is decoration — so a screen reader heard only that the button had become
 * disabled, with no way to tell work-in-progress from action-unavailable. Every stage in the
 * app puts a caller in that state for seconds at a time (dispatching, auditing, applying).
 */
describe('a loading action says it is working, not just that it is disabled', () => {
  it('marks a loading Button busy and disabled', () => {
    render(<Button loading>Run audit</Button>);
    const btn = screen.getByRole('button', { name: 'Run audit' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('leaves aria-busy off an idle Button rather than setting it false', () => {
    render(<Button>Run audit</Button>);
    expect(screen.getByRole('button', { name: 'Run audit' })).not.toHaveAttribute('aria-busy');
  });

  it('does not claim busy for a merely disabled Button', () => {
    render(<Button disabled>Run audit</Button>);
    const btn = screen.getByRole('button', { name: 'Run audit' });
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute('aria-busy');
  });

  it('does the same for an IconButton, which has no label text to soften it', () => {
    render(<IconButton aria-label="Refresh" icon={<Check />} loading />);
    const btn = screen.getByRole('button', { name: 'Refresh' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});
