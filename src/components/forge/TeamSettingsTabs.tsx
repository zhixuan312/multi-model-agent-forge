import Link from 'next/link';
import { TEAM_SETTINGS_ROUTES } from '@/components/forge/settings-routes';
import { SlidersHorizontal, Users } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Team settings sub-nav (team_admin only) — the two team-owned surfaces: the
 * team's own config (git token, workspace, repositories) and its member roster.
 * Same tab-bar theme as the org settings tabs; the active tab is passed in.
 */
export type TeamSettingsTab = 'team' | 'members';

const TABS: ReadonlyArray<{ key: TeamSettingsTab; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'team', label: 'Team', href: TEAM_SETTINGS_ROUTES.team, glyph: <SlidersHorizontal className="size-4" /> },
  { key: 'members', label: 'Members', href: TEAM_SETTINGS_ROUTES.members, glyph: <Users className="size-4" /> },
];

export function TeamSettingsTabs({ active }: { active: TeamSettingsTab }) {
  return (
    <div role="tablist" aria-label="Team settings" className="flex gap-1 border-b border-line">
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
