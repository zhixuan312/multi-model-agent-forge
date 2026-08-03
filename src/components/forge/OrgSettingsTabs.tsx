import { ORG_SETTINGS_ROUTES } from '@/components/forge/settings-routes';
import { Cpu, Plug, Users } from 'lucide-react';
import { NavTabs } from '@/components/ui/nav-tabs';

export type OrgSettingsTab = 'teams' | 'connections' | 'models';

const TABS: ReadonlyArray<{ key: OrgSettingsTab; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'teams', label: 'Teams', href: ORG_SETTINGS_ROUTES.teams, glyph: <Users className="size-4" /> },
  { key: 'connections', label: 'Connections', href: ORG_SETTINGS_ROUTES.connections, glyph: <Plug className="size-4" /> },
  { key: 'models', label: 'Models', href: ORG_SETTINGS_ROUTES.models, glyph: <Cpu className="size-4" /> },
];

export function OrgSettingsTabs({ active }: { active: OrgSettingsTab }) {
  return <NavTabs tabs={TABS} active={active} label="Org settings" />;
}
