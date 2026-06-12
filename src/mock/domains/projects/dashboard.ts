import { mockLatency } from '@/mock/config';
import { deriveNextAction } from '@/dashboard/next-action';
import { STAGE_ORDER } from '@/db/enums';
// Type-only imports — erased at runtime, so no cycle with dashboard-core (which
// imports this module at runtime for its mock guard).
import type { DashboardProject } from '@/dashboard/dashboard-core';
import type { StageView } from '@/projects/projects-core';
import type { StageKind, StageStatus, ProjectPhase } from '@/db/enums';
import type { ArtifactKind } from '@/db/enums';

interface Owner {
  id: string;
  name: string;
  tint: string;
}
const OWNERS = {
  admin: { id: '5bf0cfe8-ad4d-47fd-903a-74fa5d2c6fea', name: 'Admin', tint: '#c4521e' },
  mira: { id: 'mock-mira', name: 'Mira Solberg', tint: '#4e7350' },
  devon: { id: 'mock-devon', name: 'Devon Park', tint: '#355a74' },
  aisha: { id: 'mock-aisha', name: 'Aisha Rahman', tint: '#a9761a' },
  leon: { id: 'mock-leon', name: 'Leon Whitaker', tint: '#b23a48' },
} satisfies Record<string, Owner>;

const DAY = 86_400_000;

/** Five stages, statuses derived from the active stage (or all done for late phases). */
function buildStages(active: StageKind | null, allDone: boolean): StageView[] {
  const idx = active ? STAGE_ORDER.indexOf(active) : STAGE_ORDER.length;
  return STAGE_ORDER.map((kind, i) => {
    let status: StageStatus;
    if (allDone || i < idx) status = 'done';
    else if (i === idx) status = 'active';
    else status = 'pending';
    return { kind, status };
  });
}

interface Spec {
  name: string;
  summary: string;
  phase: ProjectPhase;
  currentStage: StageKind | null;
  owner: Owner;
  collaborators?: Owner[];
  updatedDays: number;
  awaitingHuman?: number;
  openAuditIssues?: number;
  agentsRunning?: number;
  latestArtifact?: { kind: ArtifactKind; version: number };
  repoCount?: number;
  unavailableRepoCount?: number;
  visibility?: 'private' | 'public';
}

const SPECS: Spec[] = [
  // ── Just started — the only active project ───────────────────────────────
  {
    name: 'Multi-region read replicas',
    summary: 'Stand up read replicas across three regions with automatic failover routing.',
    phase: 'design', currentStage: 'exploration', owner: OWNERS.admin,
    updatedDays: 0.1, agentsRunning: 1, latestArtifact: { kind: 'exploration_brief', version: 1 }, repoCount: 2, visibility: 'public',
  },

  // ── Closed / shipped (15) ────────────────────────────────────────────────
  {
    name: 'Cost dashboard', summary: 'Per-project cost attribution with budgets, alerts, and a public status tile.',
    phase: 'done', currentStage: null, owner: OWNERS.admin, collaborators: [OWNERS.mira, OWNERS.leon],
    updatedDays: 8, latestArtifact: { kind: 'plan', version: 2 }, repoCount: 2, visibility: 'public',
  },
  {
    name: 'Provider failover & retries', summary: 'Tier-aware failover across providers with scoped, idempotent retries.',
    phase: 'done', currentStage: null, owner: OWNERS.leon, collaborators: [OWNERS.devon],
    updatedDays: 14, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 3,
  },
  {
    name: 'Mobile push notifications', summary: 'Cross-platform push with per-user quiet hours and delivery receipts.',
    phase: 'done', currentStage: null, owner: OWNERS.aisha, updatedDays: 19, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 4,
  },
  {
    name: 'Audit-log redaction', summary: 'Redact secrets and PII from the audit trail before it leaves the boundary.',
    phase: 'done', currentStage: null, owner: OWNERS.devon, updatedDays: 26, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 2,
  },
  {
    name: 'Realtime collaboration cursors', summary: 'Live presence and shared cursors in the editor, with conflict-free merges.',
    phase: 'done', currentStage: null, owner: OWNERS.mira, collaborators: [OWNERS.devon, OWNERS.aisha],
    updatedDays: 33, latestArtifact: { kind: 'plan', version: 2 }, repoCount: 3, visibility: 'public',
  },
  {
    name: 'Webhook delivery guarantees', summary: 'At-least-once webhook delivery with signed payloads and a dead-letter queue.',
    phase: 'done', currentStage: null, owner: OWNERS.mira, updatedDays: 41, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 1,
  },
  {
    name: 'Billing usage metering', summary: 'Meter token + compute usage per team and roll it up for invoicing.',
    phase: 'done', currentStage: null, owner: OWNERS.admin, collaborators: [OWNERS.leon],
    updatedDays: 52, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 2, visibility: 'public',
  },
  {
    name: 'Onboarding wizard rewrite', summary: 'Replace the legacy onboarding with a guided, resumable per-step flow.',
    phase: 'done', currentStage: null, owner: OWNERS.devon, updatedDays: 63, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 2, visibility: 'public',
  },
  {
    name: 'Search relevance v2', summary: 'Hybrid lexical + semantic ranking with a feedback-driven tuning loop.',
    phase: 'done', currentStage: null, owner: OWNERS.aisha, collaborators: [OWNERS.admin],
    updatedDays: 77, latestArtifact: { kind: 'plan', version: 2 }, repoCount: 1,
  },
  {
    name: 'SSO with SAML', summary: 'Enterprise single sign-on with SAML 2.0 and SCIM user provisioning.',
    phase: 'done', currentStage: null, owner: OWNERS.leon, updatedDays: 90, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 2,
  },
  {
    name: 'Rate limiter v2', summary: 'Token-bucket rate limiting with per-tenant quotas and burst credits.',
    phase: 'done', currentStage: null, owner: OWNERS.devon, collaborators: [OWNERS.mira],
    updatedDays: 108, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 1,
  },
  {
    name: 'Data export pipeline', summary: 'Self-serve bulk export to S3/GCS with resumable, signed downloads.',
    phase: 'done', currentStage: null, owner: OWNERS.admin, updatedDays: 130, latestArtifact: { kind: 'plan', version: 2 }, repoCount: 3, visibility: 'public',
  },
  {
    name: 'Feature flags service', summary: 'Targeted rollouts with audiences, kill switches, and an audit trail.',
    phase: 'done', currentStage: null, owner: OWNERS.mira, collaborators: [OWNERS.aisha],
    updatedDays: 156, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 2,
  },
  {
    name: 'Image CDN migration', summary: 'Migrate asset delivery to a CDN with on-the-fly resizing and caching.',
    phase: 'done', currentStage: null, owner: OWNERS.aisha, updatedDays: 188, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 1,
  },
  {
    name: 'Incident runbooks', summary: 'Codified on-call runbooks with one-click rollbacks and status updates.',
    phase: 'done', currentStage: null, owner: OWNERS.leon, collaborators: [OWNERS.devon],
    updatedDays: 232, latestArtifact: { kind: 'plan', version: 1 }, repoCount: 2, visibility: 'public',
  },
];

const PROJECTS: DashboardProject[] = SPECS.map((s, i) => {
  const awaitingHuman = s.awaitingHuman ?? 0;
  const openAuditIssues = s.openAuditIssues ?? 0;
  return {
    id: `mock-project-${String(i + 1).padStart(2, '0')}`,
    name: s.name,
    summary: s.summary,
    visibility: s.visibility ?? 'private',
    phase: s.phase,
    currentStage: s.currentStage,
    ownerId: s.owner.id,
    ownerDisplayName: s.owner.name,
    ownerAvatarTint: s.owner.tint,
    updatedAt: new Date(Date.now() - s.updatedDays * DAY),
    isMember: true,
    stages: buildStages(s.currentStage, s.phase === 'done'),
    repoCount: s.repoCount ?? 1,
    unavailableRepoCount: s.unavailableRepoCount ?? 0,
    awaitingHuman,
    openAuditIssues,
    agentsRunning: s.agentsRunning ?? 0,
    latestArtifact: s.latestArtifact ?? null,
    collaborators: (s.collaborators ?? []).map((c) => ({ id: c.id, displayName: c.name, avatarTint: c.tint })),
    nextAction: deriveNextAction({ phase: s.phase, currentStage: s.currentStage, awaitingHuman, openAuditIssues }),
  };
});

export async function dashboardProjects(): Promise<DashboardProject[]> {
  await mockLatency();
  // Newest first (the real query orders by updated_at desc).
  return [...PROJECTS].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Look up a seeded project by id — used by the detail route's mock guard. */
export function findMockProject(id: string): DashboardProject | null {
  return PROJECTS.find((p) => p.id === id) ?? null;
}
