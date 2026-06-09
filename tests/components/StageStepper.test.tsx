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
];

function renderFresh() {
  return render(
    <StageStepper projectId="p1" stages={freshStages} currentStage="exploration" phase="design" />,
  );
}

describe('StageStepper (stage-driven)', () => {
  it('renders the three groups Design / Freeze / Build', () => {
    const { container } = renderFresh();
    const headings = Array.from(container.querySelectorAll('span.uppercase')).map((el) => el.textContent);
    expect(headings).toEqual(['Design', 'Freeze', 'Build']);
  });

  it('highlights current_stage and locks all three Build stages under design phase', () => {
    const { container } = renderFresh();
    const exploration = container.querySelector('[data-stage="exploration"]')!;
    expect(exploration).toHaveAttribute('data-state', 'active');
    expect(exploration).toHaveAttribute('aria-current', 'step');

    for (const kind of ['plan', 'execute', 'review']) {
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

    // plan (locked) → inert span
    const plan = container.querySelector('[data-stage="plan"]')!;
    expect(plan.tagName).toBe('SPAN');
  });

  it('a11y: each stage accessible name includes its status; locked stages say "locked"', () => {
    renderFresh();
    expect(screen.getByLabelText('Exploration — active')).toBeInTheDocument();
    expect(screen.getByLabelText('Spec — pending')).toBeInTheDocument();
    expect(screen.getByLabelText('Plan — locked')).toBeInTheDocument();
  });
});
