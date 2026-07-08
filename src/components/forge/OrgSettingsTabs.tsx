import Link from 'next/link';
import { Users, Plug, Cpu } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Org settings sub-nav (org_admin only) — the three shared-infrastructure
 * surfaces: the teams in this deployment, the MMA/voice connection, and the
 * provider model tiers. Same tab-bar theme as the rest of the app; the active
 * tab is passed in by each server page.
 */
export type OrgSettingsTab = 'teams' | 'connections' | 'models';

const TABS: ReadonlyArray<{ key: OrgSettingsTab; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'teams', label: 'Teams', href: '/settings/org', glyph: <Users className="size-4" /> },
  { key: 'connections', label: 'Connections', href: '/settings/connections', glyph: <Plug className="size-4" /> },
  { key: 'models', label: 'Models', href: '/settings/models', glyph: <Cpu className="size-4" /> },
];

export function OrgSettingsTabs({ active }: { active: OrgSettingsTab }) {
  return (
    <div role="tablist" aria-label="Org settings" className="flex gap-1 border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={active === tab.key}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cn(
            'focus-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
            active === tab.key ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          <span aria-hidden className="inline-flex">{tab.glyph}</span>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
