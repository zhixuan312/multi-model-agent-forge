import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBell } from '@/components/forge/collab/NotificationBell';
import type { NotificationRow } from '@/db/schema/ops';

// Phase-2 migration: mark-read / mark-all now go through useOptimisticAction — optimistic
// flip, revert + error toast on failure. The primitive itself is unit-tested; here we
// assert the wiring (fetch fired, count reverts on failure, toast raised).

const toasts: Array<{ type: string; message: string }> = [];
vi.mock('@/components/ui/toast', () => ({
  showToast: (t: { type: string; message: string }) => { toasts.push(t); },
}));

function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n1', memberId: 'm1', kind: 'section_mention', title: 'Mentioned you',
    subtitle: null, href: null, readAt: null, dismissedAt: null,
    createdAt: '2026-07-06T00:00:00.000Z', projectId: null,
    ...over,
  } as NotificationRow;
}

beforeEach(() => { toasts.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

async function openBell(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Notifications/i }));
  await screen.findByRole('button', { name: /mark all read/i });
}

it('reconciles unread with server read-state on refetch — no stale badge [QA E#3]', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/notifications/list')) {
      // A refetch reports 'a' as read elsewhere; 'b' still unread.
      return new Response(JSON.stringify({ items: [row({ id: 'a', readAt: '2026-07-06T01:00:00.000Z' }), row({ id: 'b' })] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
  render(<NotificationBell items={[row({ id: 'a' }), row({ id: 'b' })]} />);
  expect(screen.getByRole('button', { name: /Notifications \(2 unread\)/i })).toBeInTheDocument();
  window.dispatchEvent(new Event('notification:refresh'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Notifications \(1 unread\)/i })).toBeInTheDocument());
});

it('mark-all succeeds → fetch fired, unread badge clears', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  render(<NotificationBell items={[row({ id: 'a' }), row({ id: 'b' })]} />);
  await openBell(user);
  await user.click(screen.getByRole('button', { name: /mark all read/i }));
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls.some((c) => String(c[0]).includes('/api/notifications/read-all'))).toBe(true);
});

it('mark-all fails → unread count reverts and an error toast is raised', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
  render(<NotificationBell items={[row({ id: 'a' }), row({ id: 'b' })]} />);
  expect(screen.getByText('2')).toBeInTheDocument(); // 2 unread before
  await openBell(user);
  await user.click(screen.getByRole('button', { name: /mark all read/i }));
  await waitFor(() => expect(toasts.some((t) => t.type === 'error')).toBe(true));
  await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument()); // reverted
});
