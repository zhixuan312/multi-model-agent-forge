import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Team Settings tab bar (Spec 1 §Team Settings). Members is the only active tab;
 * Agent roster / Providers / Connections are present-but-disabled placeholders
 * (filled in Spec 2). Server component — the active tab is passed in.
 */
export type SettingsTab = 'members';

const DISABLED = ['Agent roster', 'Providers', 'Connections'] as const;

export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <div role="tablist" className="mb-6 flex gap-6 border-b border-line">
      {DISABLED.map((label) => (
        <span
          key={label}
          role="tab"
          aria-disabled="true"
          aria-selected={false}
          className="cursor-not-allowed py-2.5 text-sm text-ink-faint"
        >
          {label}
        </span>
      ))}
      <Link
        href="/settings/members"
        role="tab"
        aria-selected={active === 'members'}
        aria-current={active === 'members' ? 'page' : undefined}
        className={cn(
          'py-2.5 text-sm',
          active === 'members'
            ? 'border-b-2 border-accent font-semibold text-ink'
            : 'text-ink-soft',
        )}
      >
        Members
      </Link>
    </div>
  );
}
