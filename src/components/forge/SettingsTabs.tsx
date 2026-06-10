import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Team Settings tab bar. Members landed in Spec 1; Providers / Agent roster /
 * Connections land in Spec 2 (Part A). Workspace is a separate page (Part B).
 * Server component — the active tab is passed in.
 */
export type SettingsTab = 'members' | 'providers' | 'roster' | 'connections';

const TABS: ReadonlyArray<{ key: SettingsTab; label: string; href: string }> = [
  { key: 'members', label: 'Members', href: '/settings/members' },
  { key: 'providers', label: 'Providers', href: '/settings/providers' },
  { key: 'roster', label: 'Agent roster', href: '/settings/roster' },
  { key: 'connections', label: 'Connections', href: '/settings/connections' },
];

export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={active === tab.key}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cn(
            'focus-ring -mb-px border-b-2 px-3 py-2.5 text-sm transition-colors',
            active === tab.key
              ? 'border-accent font-medium text-ink'
              : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
