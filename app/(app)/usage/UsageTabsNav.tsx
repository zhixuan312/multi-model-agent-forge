import Link from 'next/link';
import { BarChart3, FolderKanban, Repeat, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ForgeRole } from '@/auth/auth-provider';

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

  const suffix = period && period !== 'month' ? `?period=${period}` : '';
  return (
    <div role="tablist" aria-label="Usage views" className="flex gap-1 border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`${tab.href}${suffix}`}
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
