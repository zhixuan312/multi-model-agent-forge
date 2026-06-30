'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, AlertTriangle, AtSign, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui';
import type { NotificationRow } from '@/db/schema/ops';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function shortTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' });
}

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
  const visible = useMemo(() => items.filter((n) => !n.dismissedAt), [items]);
  const unread = useMemo(() => visible.filter((n) => !readIds.has(n.id)).length, [visible, readIds]);

  function markRead(id: string): void {
    setReadIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
  }

  function markAll(): void {
    setReadIds(new Set(visible.map((n) => n.id)));
    fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
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
        <ul className="max-h-[22rem] overflow-y-auto py-1">
          {visible.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-ink-faint">You&rsquo;re all caught up.</li>
          ) : (
            visible.map((n) => (
              <NotificationRow key={n.id} n={n} isUnread={!readIds.has(n.id)} onRead={markRead} />
            ))
          )}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
  n,
  isUnread,
  onRead,
}: {
  n: NotificationRow;
  isUnread: boolean;
  onRead: (id: string) => void;
}) {
  const isFail = n.kind === 'dispatch_failed';

  return (
    <li>
      <div
        className={cn(
          'flex gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-2 cursor-pointer',
          isUnread && (isFail ? 'bg-rose-tint/30' : 'bg-accent-tint/30'),
        )}
        onClick={() => onRead(n.id)}
      >
        <span className="relative mt-0.5 shrink-0">
          {isFail ? (
            <span className="grid size-7 place-items-center rounded-full bg-[var(--rose)]/10">
              <AlertTriangle className="size-3.5 text-[var(--rose)]" />
            </span>
          ) : (
            <span className="grid size-7 place-items-center rounded-full bg-accent-tint">
              {n.kind === 'section_mention'
                ? <AtSign className="size-3.5 text-accent" strokeWidth={2.5} aria-hidden />
                : <Check className="size-3.5 text-accent" strokeWidth={2.5} aria-hidden />}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium leading-snug text-ink">{n.title}</span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
            {n.subtitle ? `${n.subtitle} · ` : ''}{shortTime(n.createdAt)}
          </span>
        </span>
        {isUnread ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden /> : null}
      </div>
    </li>
  );
}
