import { render, screen } from '@testing-library/react';
import { Governed } from '@/components/governance/governed';
import type { ResolvedGovernanceSlotState } from '@/components/governance/registry';

const badgeState: ResolvedGovernanceSlotState = {
  slotId: 'badge',
  locked: true,
  knobs: { variant: 'accent', size: 'md', dot: true, icon: false },
};

describe('Governed', () => {
  it('renders the registry canonical renderer for the requested slot', () => {
    render(<Governed slotId="badge" state={badgeState} />);
    expect(screen.getByText('Governed')).toBeInTheDocument();
  });

  it('uses the provided knob state rather than hard-coded defaults', () => {
    const { container } = render(<Governed slotId="badge" state={badgeState} />);
    expect(container.querySelector('span')).toHaveClass('bg-accent-tint');
  });
});
