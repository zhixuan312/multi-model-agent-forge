import { render, screen } from '@testing-library/react';
import { Governed } from '@/components/governance/governed';

describe('Governed', () => {
  it('renders the registry canonical renderer for the requested slot', () => {
    render(<Governed slotId="badge" />);
    // The badge preview renders the canonical Badge with the "Governed" example label.
    expect(screen.getByText('Governed')).toBeInTheDocument();
  });

  it('falls back to the slot preview when the variantId does not match', () => {
    // Badge has no variants, so an unknown variantId falls through to the slot renderer.
    render(<Governed slotId="badge" variantId="does-not-exist" />);
    expect(screen.getByText('Governed')).toBeInTheDocument();
  });
});
