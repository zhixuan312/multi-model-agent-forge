'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, AtSign, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui';
import type { NotificationItem } from '@/collab/types';

/**
 * The shell notification bell — mentions and approvals land here so a teammate
 * finds their @-mentions without browsing. Read-state is tracked client-side for
 * the walk-through (no persistence); a real store would back `read` and a
 * mark-read mutation. Renders quiet (no dot) when the feed is empty.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 13" from an ISO string — sliced, not locale-parsed, so SSR and client agree. */
function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(items.filter((n) => n.read).map((n) => n.id)),
  );
  const unread = useMemo(() => items.filter((n) => !readIds.has(n.id)).length, [items, readIds]);

  function markRead(id: string): void {
    setReadIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }
  function markAll(): void {
    setReadIds(new Set(items.map((n) => n.id)));
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
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-ink-faint">You&rsquo;re all caught up.</li>
          ) : (
            items.map((n) => {
              const isUnread = !readIds.has(n.id);
              const mention = n.kind === 'section_mention';
              return (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => markRead(n.id)}
                    className={cn(
                      'flex gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-2',
                      isUnread && 'bg-accent-tint/30',
                    )}
                  >
                    <span className="relative mt-0.5 shrink-0">
                      <Avatar size="sm" name={n.actor.displayName} tint={n.actor.avatarTint} aria-hidden />
                      <span
                        className={cn(
                          'absolute -bottom-1 -right-1 grid size-3.5 place-items-center rounded-full ring-2 ring-surface',
                          mention ? 'bg-[var(--steel)]' : 'bg-[var(--sage)]',
                        )}
                      >
                        {mention ? (
                          <AtSign className="size-2 text-white" strokeWidth={3} aria-hidden />
                        ) : (
                          <Check className="size-2 text-white" strokeWidth={3.5} aria-hidden />
                        )}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-snug text-ink">
                        <span className="font-semibold">{n.actor.displayName}</span>{' '}
                        {mention ? 'mentioned you on' : 'approved'}{' '}
                        <span className="font-medium">{n.unitLabel}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                        {n.projectName} · {shortDate(n.createdAt)}
                      </span>
                    </span>
                    {isUnread ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden /> : null}
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
