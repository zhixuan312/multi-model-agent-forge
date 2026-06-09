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
    <div role="tablist" className="mb-6 flex gap-6 border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={active === tab.key}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cn(
            'py-2.5 text-sm',
            active === tab.key
              ? 'border-b-2 border-accent font-semibold text-ink'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
