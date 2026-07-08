import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Settings tab bar — org and team settings surfaces.
 * Server component — the active tab is passed in.
 */
export type SettingsTab = 'org' | 'team';

const TABS: ReadonlyArray<{ key: SettingsTab; label: string; href: string }> = [
  { key: 'org', label: 'Org settings', href: '/settings/org' },
  { key: 'team', label: 'Team settings', href: '/settings/team' },
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
