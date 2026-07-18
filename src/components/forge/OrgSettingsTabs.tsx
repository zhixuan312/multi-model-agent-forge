import Link from 'next/link';
import { ORG_SETTINGS_ROUTES } from '@/components/forge/settings-routes';
import { Cpu, Plug, Users } from 'lucide-react';
import { cn } from '@/lib/cn';

export type OrgSettingsTab = 'teams' | 'connections' | 'models';

const TABS: ReadonlyArray<{ key: OrgSettingsTab; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'teams', label: 'Teams', href: ORG_SETTINGS_ROUTES.teams, glyph: <Users className="size-4" /> },
  { key: 'connections', label: 'Connections', href: ORG_SETTINGS_ROUTES.connections, glyph: <Plug className="size-4" /> },
  { key: 'models', label: 'Models', href: ORG_SETTINGS_ROUTES.models, glyph: <Cpu className="size-4" /> },
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
