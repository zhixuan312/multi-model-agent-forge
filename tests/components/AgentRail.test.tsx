import { render, screen } from '@testing-library/react';
import { AgentRail } from '@/components/forge/AgentRail';
import type { RailTask } from '@/hooks/useProjectEvents';

const task = (over: Partial<RailTask>): RailTask => ({
  id: 't1',
  kind: 'investigate',
  status: 'running',
  prompt: 'how does auth work?',
  targetRepoId: null,
  mmaBatchId: 'b',
  batchStatus: 'running',
  headline: 'reading files…',
  error: null,
  ...over,
});

describe('AgentRail (F19 — live region a11y)', () => {
  it('wraps the rail in an aria-live="polite" region', () => {
    render(<AgentRail tasks={[task({})]} />);
    const region = screen.getByTestId('agent-rail');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a running task headline', () => {
    render(<AgentRail tasks={[task({})]} />);
    expect(screen.getByText('reading files…')).toBeInTheDocument();
  });

  it('shows a failed task error message (derived from batchStatus, not the task row)', () => {
    render(
      <AgentRail
        tasks={[task({ status: 'recorded', batchStatus: 'failed', error: { code: 'x', message: 'it broke' } })]}
      />,
    );
    expect(screen.getByText('it broke')).toBeInTheDocument();
    const row = screen.getByText('it broke').closest('[data-task-id]');
    expect(row).toHaveAttribute('data-status', 'failed');
  });

  it('renders a recorded (done) task as locked', () => {
    render(<AgentRail tasks={[task({ status: 'recorded', batchStatus: 'done', headline: null })]} />);
    const row = screen.getByText('how does auth work?').closest('[data-task-id]');
    expect(row).toHaveAttribute('data-status', 'recorded');
  });

  it('excludes draft tasks from the rail (only dispatched tasks show)', () => {
    render(<AgentRail tasks={[task({ id: 'd1', status: 'draft', batchStatus: null })]} />);
    expect(screen.getByText('No tasks dispatched yet.')).toBeInTheDocument();
  });
});
