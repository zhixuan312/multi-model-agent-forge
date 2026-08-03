import { BarChart3, FolderKanban, Repeat, Zap } from 'lucide-react';
import type { ForgeRole } from '@/auth/auth-provider';
import { NavTabs } from '@/components/ui/nav-tabs';

export type UsageView = 'overview' | 'projects' | 'loops' | 'standalone';

const TABS: ReadonlyArray<{ key: UsageView; label: string; href: string; glyph: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', href: '/usage', glyph: <BarChart3 className="size-4" /> },
  { key: 'projects', label: 'Projects', href: '/usage/projects', glyph: <FolderKanban className="size-4" /> },
  { key: 'loops', label: 'Loops', href: '/usage/loops', glyph: <Repeat className="size-4" /> },
  { key: 'standalone', label: 'Standalone', href: '/usage/standalone', glyph: <Zap className="size-4" /> },
];

export function UsageTabsNav({ active, period, role }: { active: UsageView; period?: string; role?: ForgeRole }) {
  if (role === 'org_admin') {
    return null; // Org admin sees no tabs
  }
  // 'month' is the default, so it stays out of the URL.
  const suffix = period && period !== 'month' ? `?period=${period}` : '';
  const tabs = TABS.map((t) => ({ ...t, href: `${t.href}${suffix}` }));
  return <NavTabs tabs={tabs} active={active} label="Usage views" />;
}
