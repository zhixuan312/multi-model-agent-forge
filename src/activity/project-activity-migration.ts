import { FORGE_MEMBER_ID } from '@/automation/forge-member';

export interface LegacyProjectEvent {
  stage: string;
  phase: string;
  detail: string;
  kind?: 'action' | 'error' | 'done';
  durationMs?: number;
  at: string;
}

export interface BackfillActivityRow {
  stage: string;
  phase: string;
  label: string;
  kind: 'action' | 'running' | 'done' | 'error';
  actorId: string;
  actorName: string;
  actorTint: string;
  source: 'mma';
  durationMs: number | null;
  eventKey: string;
  createdAt: Date;
}

const FORGE_NAME = 'Forge';
const FORGE_TINT = '#9a6b4f';

export function buildForgeMemberSeed() {
  return {
    id: FORGE_MEMBER_ID,
    username: 'forge',
    displayName: FORGE_NAME,
    avatarTint: FORGE_TINT,
    role: 'org_admin' as const,
    teamId: null,
  };
}

export function buildLegacyActivityBackfillRows(
  projectId: string,
  events: LegacyProjectEvent[],
): BackfillActivityRow[] {
  return [...events]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const at = new Date(a.event.at).getTime() - new Date(b.event.at).getTime();
      return at !== 0 ? at : a.index - b.index;
    })
    .map(({ event }, index) => ({
      stage: event.stage,
      phase: event.phase,
      label: event.detail,
      kind: event.kind === 'error' ? 'error' : event.kind === 'done' ? 'done' : 'action',
      actorId: FORGE_MEMBER_ID,
      actorName: FORGE_NAME,
      actorTint: FORGE_TINT,
      source: 'mma',
      durationMs: event.durationMs ?? null,
      eventKey: `backfill:${projectId}:${index}`,
      createdAt: new Date(event.at),
    }));
}
