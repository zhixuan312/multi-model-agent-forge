import { TEAM_SETTINGS_ROUTES } from '@/components/forge/settings-routes';
import { SlidersHorizontal, Users } from 'lucide-react';
import { NavTabs } from '@/components/ui/nav-tabs';

/**
 * Team settings sub-nav (team_admin only) — the two team-owned surfaces: the
 * team's own config (git token, workspace, repositories) and its member roster.
 * Rendered by the shared `NavTabs`, so the theme matches the other sub-navs by
 * construction rather than by hand. The active tab is passed in.
 */
export type TeamSettingsTab = 'team' | 'members';

const TABS: ReadonlyArray<{ key: TeamSettingsTab; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'team', label: 'Team', href: TEAM_SETTINGS_ROUTES.team, glyph: <SlidersHorizontal className="size-4" /> },
  { key: 'members', label: 'Members', href: TEAM_SETTINGS_ROUTES.members, glyph: <Users className="size-4" /> },
];

export function TeamSettingsTabs({ active }: { active: TeamSettingsTab }) {
  return <NavTabs tabs={TABS} active={active} label="Team settings" />;
}
