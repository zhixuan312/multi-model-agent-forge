'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderKanban, LayoutDashboard, NotebookPen, Settings, Repeat, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Eyebrow } from '@/components/ui';
import { ForgeMark } from '@/components/forge/ForgeMark';
import type { AuthedMember } from '@/auth/auth-provider';

/**
 * Sidebar — the locked dashboard rail: brand lockup, grouped primary nav, and
 * the account menu footer (`shell.html`). Nav icons come from the Lucide family
 * (one icon language across the app — no Unicode glyphs). Active route gets an
 * ember left-rail + tint via `usePathname`. The Admin section is shown only to
 * admins (the page itself is admin-gated by `require-admin.ts`; hiding it is UX,
 * not the security boundary).
 */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

interface NavSection {
  id: string;
  /** Section eyebrow. Omitted for the primary group — it's the obvious top-level
   *  menu, and a "Workspace" label above a "Workspace" item just reads twice. */
  label?: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    id: 'main',
    items: [
      { href: '/projects', label: 'Projects', icon: FolderKanban },
      // Loops sits directly below Projects. Still admin-only (the /loops pages are
      // admin-gated by require-admin.ts) — so it's hidden for non-admins, just no
      // longer grouped under the "Admin" eyebrow.
      { href: '/loops', label: 'Loops', icon: Repeat, adminOnly: true },
      { href: '/journal', label: 'Journal', icon: NotebookPen },
      { href: '/workspace', label: 'Workspace', icon: LayoutDashboard },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { href: '/settings', label: 'Team settings', icon: Settings, adminOnly: true },
    ],
  },
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

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex min-h-full w-[var(--rail-w)] flex-col border-r border-line bg-surface-2 px-3 py-4',
        !forceVisible && 'max-md:hidden',
      )}
    >
      <div className="flex items-center gap-2 px-2 pb-4 pt-1">
        <ForgeMark withWordmark />
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-5">
        {SECTIONS.map((section) => {
          const items = section.items.filter((i) => !i.adminOnly || member.isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={section.id} className="flex flex-col gap-0.5">
              {section.label ? (
                <Eyebrow className="px-2.5 pb-1 !text-[0.6875rem] text-ink-faint">
                  {section.label}
                </Eyebrow>
              ) : null}
              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-2.5 rounded-[var(--r)] px-2.5 py-2 text-sm',
                      'transition-colors duration-150 ease-[var(--ease-out)]',
                      active
                        ? 'bg-accent-tint font-semibold text-accent-deep [&_svg]:text-accent'
                        : 'text-ink-soft hover:bg-bg-sunk hover:text-ink [&_svg]:text-ink-faint',
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
                      />
                    ) : null}
                    <Icon className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="flex-1" />
    </aside>
  );
}
