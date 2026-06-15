import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoopsClient } from '../../app/(app)/loops/LoopsClient';
import type { LoopRow } from '@/db/schema/loop';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const loop = {
  id: 'l1', name: 'Hygiene', kind: 'maintenance', config: { goalMd: 'no dormant code' },
  workerTier: 'complex', cron: '0 3 * * *', repoIds: ['r1'], enabled: true,
  createdBy: null, createdAt: new Date(), updatedAt: new Date(),
} as unknown as LoopRow;
const repoOptions = [{ id: 'r1', name: 'forge' }, { id: 'r2', name: 'engine' }];

describe('LoopsClient', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ runId: 'r' }), { status: 200 }));
  });

  it('lists existing loops with a human schedule, raw cron, and a Run-now action', () => {
    render(<LoopsClient initialLoops={[loop]} repoOptions={repoOptions} />);
    expect(screen.getByText('Daily at 03:00')).toBeInTheDocument();
    expect(screen.getByText('0 3 * * *')).toBeInTheDocument();
    expect(screen.getByText('Hygiene')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run hygiene now/i })).toBeInTheDocument();
  });

  it('shows "One-time" for a one-time (null-cron) job + a trigger filter', () => {
    const oneTime = { ...loop, id: 'l2', name: 'Adhoc cleanup', cron: null } as unknown as LoopRow;
    render(<LoopsClient initialLoops={[oneTime]} repoOptions={repoOptions} />);
    expect(screen.getByText('One-time')).toBeInTheDocument();
    expect(screen.getByText('Adhoc cleanup')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /filter by trigger/i })).toBeInTheDocument();
  });

  it('Edit opens an inline reconfigure form, Cancel closes it', async () => {
    render(<LoopsClient initialLoops={[loop]} repoOptions={repoOptions} />);
    expect(screen.queryByRole('form', { name: 'Edit loop' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit hygiene/i }));
    await waitFor(() => expect(screen.getByRole('form', { name: 'Edit loop' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit loop' })).not.toBeInTheDocument());
  });

  it('opens the new-loop form and POSTs /api/loops on create', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 201 }));
    render(<LoopsClient initialLoops={[]} repoOptions={repoOptions} />);
    fireEvent.click(screen.getByRole('button', { name: /new loop/i }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Docs sync' } });
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'keep docs current' } });
    fireEvent.click(screen.getByLabelText('forge'));
    fireEvent.submit(screen.getByRole('form', { name: 'New loop' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.find(([u]) => u === '/api/loops');
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body).toMatchObject({ name: 'Docs sync', kind: 'maintenance', config: { goalMd: 'keep docs current' }, repoIds: ['r1'] });
  });

  it('Run now POSTs the run route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 202 }));
    render(<LoopsClient initialLoops={[loop]} repoOptions={repoOptions} />);
    fireEvent.click(screen.getByRole('button', { name: /run hygiene now/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/loops/l1/run', { method: 'POST' }));
  });

  it('disables Run now while the loop is already running', () => {
    render(<LoopsClient initialLoops={[loop]} repoOptions={repoOptions} runningLoopIds={['l1']} />);
    const btn = screen.getByRole('button', { name: /hygiene is running/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Running…')).toBeInTheDocument();
  });

  it('shows a last-run chip when provided', () => {
    render(
      <LoopsClient
        initialLoops={[loop]}
        repoOptions={repoOptions}
        lastRunByLoop={{ l1: { status: 'changed', at: '2026-06-15T02:00:00.000Z' } }}
      />,
    );
    expect(screen.getByText('Changed')).toBeInTheDocument();
  });
});
