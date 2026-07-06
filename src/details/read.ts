import type { StageKind } from '@/db/enums';
import type { Details } from '@/details/schema';

export function getCurrentPhase(details: Details, stageKind: StageKind): string | null {
  const stg = details.stages[stageKind];
  if (!stg) return null;
  for (const [key, phase] of Object.entries(stg.phases)) {
    if ((phase as { status: string }).status === 'active') return key;
  }
  return null;
}

export function getRepos(details: Details) {
  return details.repos;
}

export function getBriefText(details: Details): string {
  return details.stages.exploration.phases.brief.text ?? '';
}

/**
 * The context block id to feed the NEXT audit/review round: the last attempt with
 * a non-null `contextBlockId`. Skips write/fix attempts (null block) and legacy
 * attempts (absent). Returns null when none qualifies — caller then dispatches a
 * full (non-delta) audit.
 */
export function lastReadBlockId(
  attempts: ReadonlyArray<{ contextBlockId?: string | null }> | undefined,
): string | null {
  if (!attempts) return null;
  for (let i = attempts.length - 1; i >= 0; i--) {
    const id = attempts[i]?.contextBlockId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}
