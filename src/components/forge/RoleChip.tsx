import { Badge } from '@/components/ui';

/**
 * `RoleChip` (Spec 4 / components/forge — F7/F11) — the advisory discipline-role
 * badge rendered on `/spec/outline` component cards. A thin `Badge` composition;
 * advisory only (no gating). Spec-4-owned.
 */
export function RoleChip({ role, className }: { role: string; className?: string }) {
  return (
    <Badge variant="neutral" size="sm" className={className}>
      {role}
    </Badge>
  );
}
