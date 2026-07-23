'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderKanban, LayoutDashboard, NotebookPen, Settings, Repeat, BarChart3, Boxes, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Eyebrow } from '@/components/ui';
import { ForgeMark } from '@/components/forge/ForgeMark';
import { GOVERNANCE_SLOT_NAV } from '@/components/governance/registry';
import { TEAM_SETTINGS_HREFS, ORG_SETTINGS_HREFS } from '@/components/forge/settings-routes';
import type { AuthedMember } from '@/auth/auth-provider';

const COMPONENTS_HREF = '/settings/components';
// A page is a stack of layers in flow order (background → app shell → content shell →
// stage flow → panels), then the shared primitives used inside every layer.
const SLOT_GROUPS = [
  { key: 'structural' as const, label: 'Layers' },
  { key: 'primitive' as const, label: 'Primitives' },
];

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean | 'org_admin' | 'team_admin';
  teamScoped?: boolean;
  /** Sibling routes this item owns. Settings tabs live side by side (/settings/team,
   *  /settings/members) rather than nested, so a prefix test alone leaves the sidebar
   *  showing nothing selected on every tab but the first. */
  owns?: readonly string[];
}

interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    id: 'main',
    items: [
      { href: '/projects', label: 'Projects', icon: FolderKanban, teamScoped: true },
      { href: '/loops', label: 'Loops', icon: Repeat, adminOnly: true, teamScoped: true },
      { href: '/journal', label: 'Journal', icon: NotebookPen, teamScoped: true },
      { href: '/workspace', label: 'Workspace', icon: LayoutDashboard, teamScoped: true },
    ],
  },
  {
    id: 'admin',
    label: 'Settings',
    items: [
      { href: '/usage', label: 'Usage', icon: BarChart3 },
      { href: '/settings/components', label: 'Components', icon: Boxes, adminOnly: 'org_admin' },
      { href: '/settings/org', label: 'Org settings', icon: Settings, adminOnly: 'org_admin', owns: ORG_SETTINGS_HREFS },
      { href: '/settings/team', label: 'Team settings', icon: Settings, adminOnly: 'team_admin', owns: TEAM_SETTINGS_HREFS },
    ],
  },
];

export function Sidebar({
  member,
}: {
  member: AuthedMember;
}) {
  const pathname = usePathname();

  function visibleTo(i: NavItem): boolean {
    if (i.teamScoped && member.role === 'org_admin') return false;
    if (!i.adminOnly) return true;
    if (i.adminOnly === true) return member.role === 'org_admin' || member.role === 'team_admin';
    return member.role === i.adminOnly;
  }

  function renderLink(item: NavItem, active: boolean) {
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
  }

  function renderComponentSlots() {
    return (
      <div className="ml-3 mt-0.5 flex flex-col gap-1 border-l border-line pl-2">
        {SLOT_GROUPS.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            <Eyebrow className="px-2 pt-1 !text-[0.625rem] text-ink-faint">{group.label}</Eyebrow>
            {GOVERNANCE_SLOT_NAV.filter((s) => s.group === group.key).map((slot) => {
              const href = `${COMPONENTS_HREF}/${slot.slotId}`;
              const active = pathname === href;
              const inSlot = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <div key={slot.slotId} className="flex flex-col gap-0.5">
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-[var(--r)] px-2 py-1 text-[0.8125rem] transition-colors',
                      active
                        ? 'bg-accent-tint font-medium text-accent-deep'
                        : inSlot
                          ? 'font-medium text-ink'
                          : 'text-ink-soft hover:bg-bg-sunk hover:text-ink',
                    )}
                  >
                    {slot.label}
                  </Link>
                  {/* 3rd layer — variant sub-pages, shown while inside this slot's area. */}
                  {slot.variants.length > 0 && inSlot ? (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-line pl-2">
                      {slot.variants.map((v) => {
                        const vhref = `${href}/${v.id}`;
                        const vactive = pathname === vhref;
                        return (
                          <Link
                            key={v.id}
                            href={vhref}
                            aria-current={vactive ? 'page' : undefined}
                            className={cn(
                              'rounded-[var(--r)] px-2 py-1 text-xs transition-colors',
                              vactive
                                ? 'bg-accent-tint font-medium text-accent-deep'
                                : 'text-ink-faint hover:bg-bg-sunk hover:text-ink',
                            )}
                          >
                            {v.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex min-h-full w-[var(--rail-w)] flex-col border-r border-line bg-surface-2 px-3 py-4',
      )}
    >
      <div className="flex items-center gap-2 px-2 pb-4 pt-1">
        <ForgeMark withWordmark />
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-5">
        {SECTIONS.map((section) => {
          const items = section.items.filter(visibleTo);
          if (items.length === 0) return null;
          return (
            <div key={section.id} className="flex flex-col gap-0.5">
              {section.label ? (
                <Eyebrow className="px-2.5 pb-1 !text-[0.6875rem] text-ink-faint">
                  {section.label}
                </Eyebrow>
              ) : null}
              {items.map((item) => {
                const owned = [item.href, ...(item.owns ?? [])];
                const active = owned.some((h) => pathname === h || pathname.startsWith(`${h}/`));
                // The "Components" item expands into a nested per-component sub-page list
                // whenever the user is inside the Components area — each slot is its own page.
                if (item.href === COMPONENTS_HREF) {
                  return (
                    <div key={item.href} className="flex flex-col gap-0.5">
                      {renderLink(item, active)}
                      {active ? renderComponentSlots() : null}
                    </div>
                  );
                }
                return renderLink(item, active);
              })}
            </div>
          );
        })}
      </nav>

      <div className="flex-1" />
    </aside>
  );
}
