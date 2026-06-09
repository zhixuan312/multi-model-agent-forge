import { cn } from '@/lib/cn';

/**
 * `RoleChip` (Spec 4 / components/forge — F7/F11) — the advisory discipline-role
 * badge rendered on `/spec/outline` component cards. A thin badge composition;
 * advisory only (no gating). Spec-4-owned.
 */
export function RoleChip({ role, className }: { role: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted',
        className,
      )}
    >
      {role}
    </span>
  );
}
