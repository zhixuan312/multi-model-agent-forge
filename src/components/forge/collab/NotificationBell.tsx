'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, AlertTriangle, AtSign, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import type { NotificationRow } from '@/db/schema/ops';

import { formatTime } from '@/lib/format-date';
import { responseError } from '@/lib/err';
import type { NotificationKind } from '@/db/enums';

export function NotificationBell({ items: serverItems }: { items: NotificationRow[] }) {
  const [liveItems, setLiveItems] = useState<NotificationRow[] | null>(null);
  const items = liveItems ?? serverItems;

  const refetch = useCallback(() => {
    fetch('/api/notifications/list')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { items: NotificationRow[] } | null) => {
        if (data) setLiveItems(data.items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener('notification:refresh', handler);
    return () => window.removeEventListener('notification:refresh', handler);
  }, [refetch]);

  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(items.filter((n) => n.readAt).map((n) => n.id)),
  );
  // Reconcile with server read-state on every refetch: a notification read on another device (or
  // arriving already-read) must count as read, not linger as a stale unread badge. Union keeps any
  // optimistic local marks that the refetch hasn't caught up to yet.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reconcile read-state on every refetch (functional update returns prev unchanged when nothing new, so no cascade)
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const n of items) if (n.readAt) next.add(n.id);
      return next.size === prev.size ? prev : next;
    });
  }, [items]);
  const optimistic = useOptimisticAction();
  const visible = useMemo(() => items.filter((n) => !n.dismissedAt), [items]);
  const unread = useMemo(() => visible.filter((n) => !readIds.has(n.id)).length, [visible, readIds]);

  function markRead(id: string): void {
    if (readIds.has(id)) return; // already read — no-op (also guards reentrancy, OA-9)
    void optimistic.run({
      apply: () => setReadIds((prev) => new Set(prev).add(id)),
      commit: async () => {
        const r = await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
        if (!r.ok) throw new Error(await responseError(r, `Request failed (${r.status}).`));
      },
      rollback: () =>
        setReadIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      error: 'Couldn’t mark as read.',
      retryable: true,
    });
  }

  function markAll(): void {
    const prev = readIds; // snapshot for a clean bulk revert
    const ids = visible.map((n) => n.id);
    void optimistic.run({
      apply: () => setReadIds(new Set(ids)),
      commit: async () => {
        const r = await fetch('/api/notifications/read-all', { method: 'POST' });
        if (!r.ok) throw new Error(await responseError(r, `Request failed (${r.status}).`));
      },
      rollback: () => setReadIds(prev),
      error: 'Couldn’t mark all as read.',
      retryable: true,
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="focus-ring relative grid size-8 place-items-center rounded-[var(--r)] text-ink-faint transition-colors hover:bg-bg-sunk hover:text-ink"
      >
        <Bell className="size-[18px]" strokeWidth={2} aria-hidden />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 grid min-w-[14px] place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-[14px] text-white ring-2 ring-surface-2">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-sm font-semibold text-ink">Notifications</span>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent transition-opacity hover:opacity-70"
            >
              <CheckCheck className="size-3" aria-hidden /> Mark all read
            </button>
          ) : null}
        </div>
        {/* Not a <ul>: this sits inside Radix's role="menu" content, whose children are
            menu items. It was a list of <li><div onClick>, so marking a notification read
            was unreachable by keyboard and the menu announced itself as holding a list. */}
        <div className="max-h-[22rem] overflow-y-auto py-1">
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-faint">You&rsquo;re all caught up.</p>
          ) : (
            visible.map((n) => (
              <NotificationRow key={n.id} n={n} isUnread={!readIds.has(n.id)} onRead={markRead} />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The glyph per kind. TOTAL over `NotificationKind`, so a new kind must choose one here
 * rather than inheriting whatever the last `else` happened to be.
 *
 * The invite branch tested `'section_mention'`, which nothing writes — both invite routes
 * write `section_invite`, and `ops_notification`'s own schema comment says so. Every invite
 * therefore fell through to the generic tick, and the @-glyph that exists to distinguish one
 * was unreachable. The test fixture used the same non-existent kind, so it agreed.
 */
const KIND_GLYPH: Record<NotificationKind, { Icon: typeof AtSign; tone: 'fail' | 'normal' }> = {
  dispatch_failed: { Icon: AlertTriangle, tone: 'fail' },
  section_invite: { Icon: AtSign, tone: 'normal' },
  // Same @-glyph as an invite: both mean "a person named you". The subtitle carries the
  // difference (which stage/phase), and the titles say it outright — "invited you to
  // review" vs "mentioned you".
  mention: { Icon: AtSign, tone: 'normal' },
};

/** The column is plain `text` — a row written by an older build can carry a retired kind. */
const UNKNOWN_GLYPH = { Icon: Check, tone: 'normal' } as const;

function NotificationRow({
  n,
  isUnread,
  onRead,
}: {
  n: NotificationRow;
  isUnread: boolean;
  onRead: (id: string) => void;
}) {
  const { Icon, tone } = KIND_GLYPH[n.kind as NotificationKind] ?? UNKNOWN_GLYPH;
  const isFail = tone === 'fail';

  return (
    <DropdownMenuItem
      onSelect={() => onRead(n.id)}
      className={cn(
        'items-start gap-2.5 px-3 py-2.5',
        isUnread && (isFail ? 'bg-rose-tint/30' : 'bg-accent-tint/30'),
      )}
    >
      <span className="relative mt-0.5 shrink-0">
        <span
          className={cn(
            'grid size-7 place-items-center rounded-full',
            isFail ? 'bg-[var(--rose)]/10' : 'bg-accent-tint',
          )}
        >
          <Icon
            className={cn('size-3.5', isFail ? 'text-[var(--rose)]' : 'text-accent')}
            strokeWidth={isFail ? undefined : 2.5}
            aria-hidden
          />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium leading-snug text-ink">
          {n.title}
          {/* Unread is otherwise a background tint and an aria-hidden dot — neither reaches a
              screen reader. Same fix `StageNavigator` uses for its done rows. */}
          {isUnread ? <span className="sr-only">, unread</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
          {n.subtitle ? `${n.subtitle} · ` : ''}{formatTime(n.createdAt)}
        </span>
      </span>
      {isUnread ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden /> : null}
    </DropdownMenuItem>
  );
}
