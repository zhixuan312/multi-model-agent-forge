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
    <StageStepper projectId="p1" stages={freshStages} currentStage="exploration" />,
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
    expect(screen.getByText('Reflect')).toBeInTheDocument();
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
      <StageStepper projectId="p1" stages={stages} currentStage="spec" />,
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
      <StageStepper projectId="p1" stages={stages} currentStage="spec" lockedStages={['exploration']} />,
    );
    const locked = container.querySelector('[data-stage="exploration"]')!;
    expect(locked).toHaveAttribute('data-state', 'locked');
  });

  it('navigation: reachable (active/done) stages are links; pending stages are inert', () => {
    const { container } = renderFresh();
    const exploration = container.querySelector('[data-stage="exploration"]')!;
    expect(exploration.tagName).toBe('A');
    // Every project URL states its phase — `{stage}?phase={phase}` — including the stage
    // you're already on, so the address bar never disagrees with the stepper. With no
    // `lastPhase` supplied the link falls back to the stage's final phase.
    expect(exploration).toHaveAttribute('href', '/projects/p1/explore?phase=synthesize');

    const spec = container.querySelector('[data-stage="spec"]')!;
    expect(spec.tagName).toBe('SPAN');
    expect(spec).toHaveAttribute('aria-disabled', 'true');
  });

  it('a11y: a reachable stage is a link named with its visual state', () => {
    renderFresh();
    expect(screen.getByRole('link', { name: 'Explore — ongoing' })).toBeInTheDocument();
  });

  it('a11y: an UNREACHABLE stage carries its state as text, not a discarded aria-label', () => {
    // This assertion used to be `getByLabelText('Spec — not started')`, and it passed —
    // testing-library reads the attribute directly. The browser does not: an unreachable
    // stage renders a bare <span>, which maps to role `generic`, where ARIA prohibits
    // naming. So the label was discarded and the stage announced nothing, while the test
    // reported it as named. Querying by TEXT is what a screen reader would actually get.
    renderFresh();
    const spec = document.querySelector('[data-stage="spec"]')!;
    expect(spec).toHaveAttribute('data-reachable', 'false');
    expect(spec).toHaveTextContent('Spec');
    expect(spec).toHaveTextContent('not started');
  });

  it('sub-phases: all show done (green) when viewing a done stage and clicking back to first phase', () => {
    const stages: { kind: StageKind; status: StageStatus }[] = [
      { kind: 'exploration', status: 'done' },
      { kind: 'spec', status: 'done' },
      { kind: 'plan', status: 'active' },
      { kind: 'execute', status: 'pending' },
      { kind: 'review', status: 'pending' },
      { kind: 'journal', status: 'pending' },
    ];
    const { container } = render(
      <StageStepper
        projectId="p1"
        stages={stages}
        currentStage="exploration"
        subSteps={[
          { key: 'brief', label: 'Brief' },
          { key: 'discover', label: 'Discover' },
          { key: 'synthesize', label: 'Synthesize' },
        ]}
        activeSubPhase="brief"
      />,
    );
    const subSteps = container.querySelectorAll('[data-substep]');
    expect(subSteps).toHaveLength(3);
    const brief = container.querySelector('[data-substep="brief"]')!;
    const discover = container.querySelector('[data-substep="discover"]')!;
    const synthesize = container.querySelector('[data-substep="synthesize"]')!;
    // Brief is active (accent)
    expect(brief).toHaveAttribute('aria-current', 'step');
    // Discover and Synthesize should be done (sage-colored) because the stage is done
    expect(discover.className).toContain('sage');
    expect(synthesize.className).toContain('sage');
  });

  it('sub-phases: an ongoing (status=active) phase reads EMBER even when focused elsewhere; a done phase is sage', () => {
    // The real "Feedback Feature" explore state: brief=done, discover=done, synthesize=active,
    // viewing synthesize. Discover (done) must be sage — NOT grey — and the in-flight synthesize
    // wears the new ember treatment.
    const stages: { kind: StageKind; status: StageStatus; lastPhase?: string | null }[] = [
      { kind: 'exploration', status: 'active', lastPhase: 'synthesize' },
      { kind: 'spec', status: 'pending' }, { kind: 'plan', status: 'pending' },
      { kind: 'execute', status: 'pending' }, { kind: 'review', status: 'pending' }, { kind: 'journal', status: 'pending' },
    ];
    const { container } = render(
      <StageStepper
        projectId="p1" stages={stages} currentStage="exploration"
        subSteps={[{ key: 'brief', label: 'Brief' }, { key: 'discover', label: 'Discover' }, { key: 'synthesize', label: 'Synthesize' }]}
        subStepStatuses={{ brief: 'done', discover: 'done', synthesize: 'active' }}
        activeSubPhase="synthesize"
      />,
    );
    const discover = container.querySelector('[data-substep="discover"]')!;
    const synthesize = container.querySelector('[data-substep="synthesize"]')!;
    // Discover is DONE → sage, never grey (bg-line-strong).
    expect(discover.querySelector('span[aria-hidden="true"]')!.className).toContain('sage');
    expect(discover.querySelector('span[aria-hidden="true"]')!.className).not.toContain('bg-line-strong');
    // Synthesize is ONGOING → the new ember dot + ember text.
    expect(synthesize.className).toContain('ember');
    expect(synthesize.querySelector('span[aria-hidden="true"]')!.className).toContain('ember');
  });

  it('sub-phases: an ongoing phase you are NOT viewing is ember, not grey', () => {
    // Focus is on brief, but discover is the in-flight phase — it must be ember, not a grey
    // pending step.
    const stages: { kind: StageKind; status: StageStatus; lastPhase?: string | null }[] = [
      { kind: 'exploration', status: 'active', lastPhase: 'discover' },
      { kind: 'spec', status: 'pending' }, { kind: 'plan', status: 'pending' },
      { kind: 'execute', status: 'pending' }, { kind: 'review', status: 'pending' }, { kind: 'journal', status: 'pending' },
    ];
    const { container } = render(
      <StageStepper
        projectId="p1" stages={stages} currentStage="exploration"
        subSteps={[{ key: 'brief', label: 'Brief' }, { key: 'discover', label: 'Discover' }, { key: 'synthesize', label: 'Synthesize' }]}
        subStepStatuses={{ brief: 'done', discover: 'active', synthesize: 'pending' }}
        activeSubPhase="brief"
      />,
    );
    const discover = container.querySelector('[data-substep="discover"]')!;
    expect(discover.querySelector('span[aria-hidden="true"]')!.className).toContain('ember');
    expect(discover.querySelector('span[aria-hidden="true"]')!.className).not.toContain('bg-line-strong');
  });
});
