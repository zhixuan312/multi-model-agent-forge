'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { initials } from '@/components/forge/avatar';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * Sidebar — nav (Projects · Workspace · Journal · Team settings) + user card
 * (`shell.html`). Active-route highlight via `usePathname`. The Team-settings
 * link is shown only to admins (the page itself is admin-gated by
 * `require-admin.ts`; hiding the link is UX, not the security boundary).
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/projects', label: 'Projects', icon: '▣' },
  { href: '/workspace', label: 'Workspace', icon: '▤' },
  { href: '/journal', label: 'Journal', icon: '✦' },
  { href: '/settings', label: 'Team settings', icon: '⚙', adminOnly: true },
];

export function Sidebar({
  member,
  forceVisible = false,
}: {
  member: AuthedMember;
  /** When true, render even below md (used inside the mobile drawer). */
  forceVisible?: boolean;
}) {
  const pathname = usePathname();
  const items = NAV.filter((i) => !i.adminOnly || member.isAdmin);

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex min-h-[100dvh] w-[var(--rail-w)] flex-col gap-1 border-r border-line bg-surface-2 p-4',
        !forceVisible && 'max-md:hidden',
      )}
    >
      <div className="flex items-center gap-2.5 px-1.5 pb-3.5 pt-1.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent font-bold text-white shadow">
          ⚒
        </span>
        <span className="font-serif text-lg font-semibold text-ink">Forge</span>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-[var(--r)] px-2.5 py-2 text-sm',
                active
                  ? 'bg-accent-tint font-semibold text-accent-deep'
                  : 'text-ink-soft hover:bg-bg-sunk',
              )}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <Link
        href="/profile"
        data-testid="user-card"
        className="flex items-center gap-2.5 rounded-[var(--r-lg)] border border-line bg-surface p-2 hover:border-line-strong"
      >
        <span
          style={{ background: member.avatarTint }}
          className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold text-white"
        >
          {initials(member.displayName)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-semibold text-ink">
              {member.displayName}
            </span>
            {member.isAdmin ? (
              <span
                data-testid="admin-chip"
                className="rounded-full bg-accent-tint px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-accent-deep"
              >
                Admin
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-[11px] text-ink-faint">@{member.username}</div>
        </div>
      </Link>
    </aside>
  );
}
