import { TEAM_SETTINGS_ROUTES } from '@/components/forge/settings-routes';
import { SlidersHorizontal, Users } from 'lucide-react';
import { NavTabs } from '@/components/ui/nav-tabs';

/**
 * Team settings sub-nav (team_admin only) — the two team-owned surfaces: the team's own
 * config (git token, workspace, repositories) and its member roster. Rendered by the shared
 * `NavTabs`, so the theme matches the other sub-navs by construction rather than by hand.
 * The active tab is passed in.
 *
 * Keys and order come from the ROUTE MAP, with chrome total over them: a route added to
 * `settings-routes.ts` fails the build here rather than silently getting no tab. Same shape
 * as `OrgSettingsTabs` and `JournalTabsNav`.
 */
export type TeamSettingsTab = keyof typeof TEAM_SETTINGS_ROUTES;

const TAB_CHROME: Record<TeamSettingsTab, { label: string; glyph: React.ReactNode }> = {
  team: { label: 'Team', glyph: <SlidersHorizontal className="size-4" /> },
  members: { label: 'Members', glyph: <Users className="size-4" /> },
};

export function TeamSettingsTabs({ active }: { active: TeamSettingsTab }) {
  const tabs = (Object.keys(TEAM_SETTINGS_ROUTES) as TeamSettingsTab[]).map((key) => ({
    key,
    href: TEAM_SETTINGS_ROUTES[key],
    ...TAB_CHROME[key],
  }));
  return <NavTabs tabs={tabs} active={active} label="Team settings" />;
}
