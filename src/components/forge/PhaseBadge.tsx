import { Badge, type BadgeProps } from '@/components/ui';
import type { ProjectPhase } from '@/db/enums';

/**
 * PhaseBadge — the project lifecycle pill (design → frozen → build → done) as a
 * proper status chip with a tinted dot, not bare text. Colors read the phase's
 * temperament: design is warm ember, frozen cools to steel, build is amber
 * (work in flight), done settles to sage. One mapping, reused wherever a phase
 * is shown (header, cards).
 */
const PHASE: Record<ProjectPhase, { label: string; variant: BadgeProps['variant'] }> = {
  design: { label: 'Design', variant: 'accent' },
  frozen: { label: 'Frozen', variant: 'steel' },
  build: { label: 'Build', variant: 'amber' },
  done: { label: 'Done', variant: 'sage' },
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
