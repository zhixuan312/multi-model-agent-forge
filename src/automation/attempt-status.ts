/**
 * Whether an attempt is "parked" — in flight or deliberately stopped, and therefore not
 * something the driver may act on or retry.
 *
 * Duplicated in audit-loop-policy and details-resolver; both decide whether the automation
 * driver moves. If they disagreed, one would advance a stage whose attempt the other still
 * considers live.
 */
export function isParked(attempt?: { status: string } | null): boolean {
  return attempt?.status === 'running' || attempt?.status === 'cancelled';
}
