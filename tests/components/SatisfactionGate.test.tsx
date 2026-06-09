import { render, screen, fireEvent } from '@testing-library/react';
import { SatisfactionGate } from '@/components/forge/SatisfactionGate';

describe('SatisfactionGate (dual indicator + force-advance)', () => {
  it('conveys AI/Human state by text label + ARIA, never colour alone (F21/F9)', () => {
    render(<SatisfactionGate aiSatisfied={true} humanSatisfied={false} forced={false} drafted={true} />);
    expect(screen.getByLabelText('AI: satisfied')).toBeInTheDocument();
    expect(screen.getByLabelText('Human: pending')).toBeInTheDocument();
    // The text is present (not colour-only).
    expect(screen.getByText(/AI: satisfied/)).toBeInTheDocument();
    expect(screen.getByText(/Human: pending/)).toBeInTheDocument();
  });

  it('Force advance is a labelled button (text, not just amber styling)', () => {
    render(<SatisfactionGate aiSatisfied={false} humanSatisfied={false} forced={false} drafted={false} />);
    expect(screen.getByRole('button', { name: 'Force advance' })).toBeInTheDocument();
  });

  it('the "Looks good" nod is disabled until the section is drafted', () => {
    const { rerender } = render(
      <SatisfactionGate aiSatisfied={false} humanSatisfied={false} forced={false} drafted={false} />,
    );
    expect(screen.getByRole('button', { name: 'Looks good' })).toBeDisabled();
    rerender(<SatisfactionGate aiSatisfied={true} humanSatisfied={false} forced={false} drafted={true} />);
    expect(screen.getByRole('button', { name: 'Looks good' })).not.toBeDisabled();
  });

  it('fires onNod / onForceAdvance', () => {
    const onNod = vi.fn();
    const onForceAdvance = vi.fn();
    render(
      <SatisfactionGate
        aiSatisfied={true}
        humanSatisfied={false}
        forced={false}
        drafted={true}
        onNod={onNod}
        onForceAdvance={onForceAdvance}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Looks good' }));
    fireEvent.click(screen.getByRole('button', { name: 'Force advance' }));
    expect(onNod).toHaveBeenCalled();
    expect(onForceAdvance).toHaveBeenCalled();
  });
});
