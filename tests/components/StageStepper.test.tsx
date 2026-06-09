import { render, screen } from '@testing-library/react';
import { StageStepper, type StageStepperStep } from '@/components/forge/StageStepper';

const steps: StageStepperStep[] = [
  { group: 'design', stage: 'exploration', label: 'Exploration', state: 'active' },
  { group: 'design', stage: 'spec', label: 'Spec', state: 'locked' },
  { group: 'freeze', stage: 'freeze', label: 'Freeze', state: 'locked' },
  { group: 'build', stage: 'plan', label: 'Plan', state: 'locked' },
  { group: 'build', stage: 'execute', label: 'Execute', state: 'locked' },
  { group: 'build', stage: 'review', label: 'Review', state: 'done' },
];

describe('StageStepper', () => {
  it('renders all three groups from props', () => {
    const { container } = render(<StageStepper steps={steps} />);
    // Group headings carry the uppercase tracking class; the stage labels do not.
    // ("Freeze" is both a group name AND a stage label, so match the headings.)
    const headings = Array.from(container.querySelectorAll('span.uppercase')).map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(['Design', 'Freeze', 'Build']);
  });

  it('reflects per-step active/locked/done state from props', () => {
    const { container } = render(<StageStepper steps={steps} />);
    const active = container.querySelector('[data-stage="exploration"]');
    const locked = container.querySelector('[data-stage="spec"]');
    const done = container.querySelector('[data-stage="review"]');
    expect(active).toHaveAttribute('data-state', 'active');
    expect(active).toHaveAttribute('aria-current', 'step');
    expect(locked).toHaveAttribute('data-state', 'locked');
    expect(done).toHaveAttribute('data-state', 'done');
  });

  it('condensed mode shows only the active step label', () => {
    render(<StageStepper steps={steps} condensed />);
    expect(screen.getByText('Exploration')).toBeInTheDocument();
    // a locked step's label is hidden in condensed mode
    expect(screen.queryByText('Spec')).not.toBeInTheDocument();
  });
});
