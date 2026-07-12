// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { LoopForm } from '../../app/(app)/loops/LoopForm';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

describe('LoopForm', () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && String(init.body).includes('rotateEventToken')) {
        return new Response(JSON.stringify({ loop: { id: 'l1' }, eventToken: 'rotated-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({ loop: { id: 'l1' }, eventToken: 'created-token' }), { status: 201 });
    }) as never);
  });

  it('creates an event-mode loop and reveals the plaintext token once', async () => {
    render(<LoopForm mode="add" repoOptions={[{ id: 'r1', name: 'forge' }]} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Incident loop' } });
    fireEvent.click(screen.getByRole('radio', { name: /event/i }));
    fireEvent.click(screen.getByLabelText(/forge/i));
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: 'Investigate incident' } });
    fireEvent.click(screen.getByRole('button', { name: /create loop/i }));

    await waitFor(() => expect(screen.getByText(/created-token/i)).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/loops', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"mode":"event"'),
    }));
  });

  it('rotates the token for an existing event loop', async () => {
    render(
      <LoopForm
        mode="edit"
        loop={{
          id: 'l1',
          teamId: 'team-1',
          name: 'Incident loop',
          kind: 'maintenance',
          config: { goalMd: 'Investigate incident' },
          workerTier: 'complex',
          mode: 'event',
          cron: null,
          targetBranch: null,
          repoIds: ['r1'],
          eventTokenHash: 'hash-1',
          enabled: true,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as never}
        repoOptions={[{ id: 'r1', name: 'forge' }]}
        onDone={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /rotate token/i }));
    await waitFor(() => expect(screen.getByText(/rotated-token/i)).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/loops/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ rotateEventToken: true }),
    }));
  });
});
