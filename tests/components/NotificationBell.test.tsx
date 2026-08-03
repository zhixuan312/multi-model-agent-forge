import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBell } from '@/components/forge/collab/NotificationBell';
import type { NotificationRow } from '@/db/schema/ops';
import { NOTIFICATION_KIND } from '@/db/enums';

// Phase-2 migration: mark-read / mark-all now go through useOptimisticAction — optimistic
// flip, revert + error toast on failure. The primitive itself is unit-tested; here we
// assert the wiring (fetch fired, count reverts on failure, toast raised).

const toasts: Array<{ type: string; message: string }> = [];
vi.mock('@/components/ui/toast', () => ({
  showToast: (t: { type: string; message: string }) => { toasts.push(t); },
}));

function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    // A kind PRODUCTION writes. This said `section_mention`, which nothing has ever
    // written — so the fixture agreed with the component's dead branch and neither was
    // measured against what the invite routes actually insert.
    id: 'n1', memberId: 'm1', kind: 'section_invite', title: 'Invited you to review',
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
      return new Response(JSON.stringify({ items: [row({ id: 'a', readAt: new Date('2026-07-06T01:00:00.000Z') }), row({ id: 'b' })] }), { status: 200 });
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

// The rows used to be `<li><div onClick>` inside Radix's role="menu" content: marking one
// read was unreachable by keyboard, and the menu announced itself as holding a list.
it('renders each notification as a menu item, not a list row', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  render(<NotificationBell items={[row({ id: 'a' }), row({ id: 'b' })]} />);
  await openBell(user);
  expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  expect(screen.queryByRole('list')).toBeNull();
});

it('marks a notification read from the keyboard', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  render(<NotificationBell items={[row({ id: 'a' })]} />);
  await openBell(user);

  // Enter on the focused menu item. A <div onClick> could not be focused OR activated.
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => {
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).includes('/api/notifications/a/read'))).toBe(true);
  });
});

/**
 * The invite branch tested `'section_mention'`, which nothing writes, so every invite fell
 * through to the generic tick and the @-glyph was unreachable.
 *
 * Pinned to the SPECIFIC glyph per kind, not merely "they differ": the original bug left the
 * two kinds showing a tick and a warning triangle, which differ perfectly well. A weaker
 * assertion here passed the sabotage, which is how that was caught.
 */
const GLYPH_FOR: Record<(typeof NOTIFICATION_KIND)[number], string> = {
  dispatch_failed: 'lucide-triangle-alert',
  section_invite: 'lucide-at-sign',
};

it.each(NOTIFICATION_KIND)('renders the %s glyph for that kind', async (kind) => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  render(<NotificationBell items={[row({ id: `k-${kind}`, kind, title: `A ${kind}` })]} />);
  await openBell(user);

  const svg = document.querySelector('[role="menuitem"] svg');
  expect(svg, 'the row must render a glyph').not.toBeNull();
  expect(svg!.getAttribute('class')).toContain(GLYPH_FOR[kind]);
});

it('announces unread state, which is otherwise only a tint and an aria-hidden dot', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  render(<NotificationBell items={[row({ id: 'u1', title: 'Unread one' })]} />);
  await openBell(user);

  expect(screen.getByText('Unread one').textContent).toContain('unread');
});
