import { Badge, type BadgeProps } from '@/components/ui';
import type { ProjectPhase } from '@/db/enums';

const PHASE: Record<ProjectPhase, { label: string; variant: BadgeProps['variant'] }> = {
  design: { label: 'Design', variant: 'accent' },
  build: { label: 'Build', variant: 'amber' },
  learn: { label: 'Learn', variant: 'sage' },
  completed: { label: 'Completed', variant: 'sage' },
};

export function PhaseBadge({
  phase,
  size = 'sm',
  className,
}: {
  phase: ProjectPhase;
  size?: BadgeProps['size'];
  className?: string;
}) {
  const { label, variant } = PHASE[phase];
  return (
    <Badge variant={variant} size={size} dot data-testid="phase-badge" className={className}>
      {label}
    </Badge>
  );
}
