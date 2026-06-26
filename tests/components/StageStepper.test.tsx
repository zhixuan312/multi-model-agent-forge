import { render, screen } from '@testing-library/react';
import { StageStepper } from '@/components/forge/StageStepper';
import type { StageKind, StageStatus } from '@/db/enums';

const freshStages: { kind: StageKind; status: StageStatus }[] = [
  { kind: 'exploration', status: 'active' },
  { kind: 'spec', status: 'pending' },
  { kind: 'plan', status: 'pending' },
  { kind: 'execute', status: 'pending' },
  { kind: 'review', status: 'pending' },
  { kind: 'journal', status: 'pending' },
];

function renderFresh() {
  return render(
    <StageStepper projectId="p1" stages={freshStages} currentStage="exploration" phase="design" />,
  );
}

describe('StageStepper (4-state track)', () => {
  it('renders all 6 stage labels', () => {
    renderFresh();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Spec')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Execute')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Journal')).toBeInTheDocument();
  });

  it('marks exploration as ongoing (current)', () => {
    const { container } = renderFresh();
    const exploration = container.querySelector('[data-stage="exploration"]')!;
    expect(exploration).toHaveAttribute('data-state', 'ongoing');
    expect(exploration).toHaveAttribute('aria-current', 'step');
  });

  it('pending stages are not_started', () => {
    const { container } = renderFresh();
    const spec = container.querySelector('[data-stage="spec"]')!;
    expect(spec).toHaveAttribute('data-state', 'not_started');
    expect(spec).toHaveAttribute('aria-disabled', 'true');
  });

  it('done stages show as done (without lockedStages)', () => {
    const stages: { kind: StageKind; status: StageStatus }[] = [
      { kind: 'exploration', status: 'done' },
      { kind: 'spec', status: 'active' },
      { kind: 'plan', status: 'pending' },
      { kind: 'execute', status: 'pending' },
      { kind: 'review', status: 'pending' },
      { kind: 'journal', status: 'pending' },
    ];
    const { container } = render(
      <StageStepper projectId="p1" stages={stages} currentStage="spec" phase="design" />,
    );
    const done = container.querySelector('[data-stage="exploration"]')!;
    expect(done).toHaveAttribute('data-state', 'done');
  });

  it('done stages show as locked when in lockedStages', () => {
    const stages: { kind: StageKind; status: StageStatus }[] = [
      { kind: 'exploration', status: 'done' },
      { kind: 'spec', status: 'active' },
      { kind: 'plan', status: 'pending' },
      { kind: 'execute', status: 'pending' },
      { kind: 'review', status: 'pending' },
      { kind: 'journal', status: 'pending' },
    ];
    const { container } = render(
      <StageStepper projectId="p1" stages={stages} currentStage="spec" phase="design" lockedStages={['exploration']} />,
    );
    const locked = container.querySelector('[data-stage="exploration"]')!;
    expect(locked).toHaveAttribute('data-state', 'locked');
  });

  it('navigation: reachable (active/done) stages are links; pending stages are inert', () => {
    const { container } = renderFresh();
    const exploration = container.querySelector('[data-stage="exploration"]')!;
    expect(exploration.tagName).toBe('A');
    expect(exploration).toHaveAttribute('href', '/projects/p1/explore');

    const spec = container.querySelector('[data-stage="spec"]')!;
    expect(spec.tagName).toBe('SPAN');
    expect(spec).toHaveAttribute('aria-disabled', 'true');
  });

  it('a11y: accessible names include visual state', () => {
    renderFresh();
    expect(screen.getByLabelText('Explore — ongoing')).toBeInTheDocument();
    expect(screen.getByLabelText('Spec — not started')).toBeInTheDocument();
  });
});
