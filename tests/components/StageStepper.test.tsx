import { render, screen } from '@testing-library/react';
import { StageStepper } from '@/components/forge/StageStepper';
import type { StageKind, StageStatus } from '@/db/enums';

// A freshly-created project: exploration active, the rest pending, phase=design.
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

describe('StageStepper (stage-driven)', () => {
  it('renders the three groups Design / Build / Learn', () => {
    const { container } = renderFresh();
    const headings = Array.from(container.querySelectorAll('span.uppercase')).map((el) => el.textContent);
    expect(headings).toEqual(['Design', 'Build', 'Learn']);
  });

  it('Plan is reachable under design; Build + Learn stages lock', () => {
    const { container } = renderFresh();
    const exploration = container.querySelector('[data-stage="exploration"]')!;
    expect(exploration).toHaveAttribute('data-state', 'active');
    expect(exploration).toHaveAttribute('aria-current', 'step');

    // plan is a DESIGN stage now — pending but NOT locked.
    const plan = container.querySelector('[data-stage="plan"]')!;
    expect(plan).toHaveAttribute('data-state', 'pending');

    for (const kind of ['execute', 'review', 'journal']) {
      const el = container.querySelector(`[data-stage="${kind}"]`)!;
      expect(el).toHaveAttribute('data-state', 'locked');
      expect(el).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('done glyph is exactly ● (F3)', () => {
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
    expect(done.textContent).toContain('●');
    expect(done.textContent).not.toContain('✓');
  });

  it('navigation: a reachable (active) stage is a link; pending + locked stages are inert', () => {
    const { container } = renderFresh();
    // exploration (active) → focusable link to its stageRoute
    const exploration = container.querySelector('[data-stage="exploration"]')!;
    expect(exploration.tagName).toBe('A');
    expect(exploration).toHaveAttribute('href', '/projects/p1/explore');

    // spec (pending, not locked) → inert span, no href, aria-disabled
    const spec = container.querySelector('[data-stage="spec"]')!;
    expect(spec.tagName).toBe('SPAN');
    expect(spec).toHaveAttribute('aria-disabled', 'true');

    // execute (locked) → inert span
    const execute = container.querySelector('[data-stage="execute"]')!;
    expect(execute.tagName).toBe('SPAN');
  });

  it('a11y: each stage accessible name includes its status; locked stages say "locked"', () => {
    renderFresh();
    expect(screen.getByLabelText('Explore — active')).toBeInTheDocument();
    expect(screen.getByLabelText('Spec — pending')).toBeInTheDocument();
    expect(screen.getByLabelText('Plan — pending')).toBeInTheDocument();
    expect(screen.getByLabelText('Execute — locked')).toBeInTheDocument();
  });
});
