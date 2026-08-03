// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvatarPicker, AVATAR_TINTS, tintName } from '@/components/ui/avatar-picker';

/**
 * The swatches were named by their hex, so a screen reader announced "Avatar colour
 * #6A6F8C" — a name in the technical sense and useless as a choice: seven options
 * indistinguishable by ear.
 */
describe('AvatarPicker names its colours', () => {
  it('gives every palette tint a spoken name, not a hex', () => {
    for (const t of AVATAR_TINTS) {
      const name = tintName(t);
      expect(name, t).not.toBe(t);
      expect(name, t).toMatch(/^[A-Z][a-z]+$/);
    }
    // …and distinct names, or two swatches sound identical.
    expect(new Set(AVATAR_TINTS.map(tintName)).size).toBe(AVATAR_TINTS.length);
  });

  it('falls back to the hex for a tint outside the palette', () => {
    expect(tintName('#123456')).toBe('#123456');
  });

  it('labels each swatch with its name and reports the selected one', () => {
    const onChange = vi.fn();
    render(<AvatarPicker initials="AL" value={AVATAR_TINTS[1]} onChange={onChange} />);

    const selected = screen.getByRole('radio', { name: `Avatar colour: ${tintName(AVATAR_TINTS[1])}` });
    expect(selected).toHaveAttribute('aria-checked', 'true');

    const other = screen.getByRole('radio', { name: `Avatar colour: ${tintName(AVATAR_TINTS[3])}` });
    fireEvent.click(other);
    expect(onChange).toHaveBeenCalledWith(AVATAR_TINTS[3]);
  });
});
