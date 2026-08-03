import { ORG_SETTINGS_ROUTES } from '@/components/forge/settings-routes';
import { Cpu, Plug, Users } from 'lucide-react';
import { NavTabs } from '@/components/ui/nav-tabs';

/**
 * Org settings sub-nav. The tab keys are the ROUTE MAP's keys and the chrome is total over
 * them, so a route added to `settings-routes.ts` fails the build here instead of quietly
 * getting no tab — `JournalTabsNav` follows the same shape for the journal views.
 *
 * The tabs render in the route map's own order, which is also the order the sidebar reads.
 */
export type OrgSettingsTab = keyof typeof ORG_SETTINGS_ROUTES;

const TAB_CHROME: Record<OrgSettingsTab, { label: string; glyph: React.ReactNode }> = {
  teams: { label: 'Teams', glyph: <Users className="size-4" /> },
  connections: { label: 'Connections', glyph: <Plug className="size-4" /> },
  models: { label: 'Models', glyph: <Cpu className="size-4" /> },
};

export function OrgSettingsTabs({ active }: { active: OrgSettingsTab }) {
  const tabs = (Object.keys(ORG_SETTINGS_ROUTES) as OrgSettingsTab[]).map((key) => ({
    key,
    href: ORG_SETTINGS_ROUTES[key],
    ...TAB_CHROME[key],
  }));
  return <NavTabs tabs={tabs} active={active} label="Org settings" />;
}
