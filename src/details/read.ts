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
