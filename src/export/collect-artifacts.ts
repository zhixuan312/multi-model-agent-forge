/**
 * Stage-0 of the export service (Spec 8 §"collect-artifacts.ts", §1a, F1/F3/F25/F27).
 *
 * Responsibilities:
 *  - VISIBILITY: every read goes through `assertProjectReadable` first (private →
 *    throws `ProjectAccessError`, mapped to 403 at the route, F-visibility).
 *  - READY/PENDING: for each of the four deliverable kinds (exploration · spec ·
 *    plan · review), determine whether the latest artifact (or the review batch
 *    result) exists.
 *  - locked·audited flag (F4): the Specification menu badge is derived —
 *    `project.phase ∈ {build,done}` AND ≥1 clean spec audit.
 *  - COVER META (§1a): owner / visibility / components-N-approved /
 *    audit-clean-N / version (+ `· locked`).
 *  - PER-SECTION HEADER MAP (F1): for the spec, `NN → {status, roles}` from the
 *    details components.
 *  - REVIEW→MARKDOWN adapter (F25): normalize the review batch result.
 */
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { readExplorationSummary as readExplorationSummarySync, readSpecFile, readPlanFile, readJournalFile } from '@/projects/project-files';
import { project } from '@/db/schema/projects';
import { member } from '@/db/schema/identity';
import { assertProjectReadable, type ProjectActor } from '@/projects/projects-core';
import { validateDetails } from '@/details/schema';
import type { CoverMeta, ExportKind, SectionHeaderMap } from '@/export/types';

export type { ExportKind };

const DELIVERABLE_KINDS: ExportKind[] = ['exploration', 'spec', 'plan', 'journal'];

const KIND_LABEL: Record<ExportKind, string> = {
  exploration: 'Exploration',
  spec: 'Specification',
  plan: 'Plan',
  journal: 'Journal',
};

/** One row in the `Export ▾` menu model (Key flow A). */
export interface ArtifactMenuItem {
  kind: ExportKind;
  label: string;
  ready: boolean;
  /** Latest artifact version (null when pending / review). */
  version: number | null;
  /** Spec only (F4): true ⟺ locked-phase AND ≥1 clean spec audit. */
  lockedAudited: boolean;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Latest artifact for a deliverable kind. All read from physical files. */
function latestArtifact(
  projectId: string,
  kind: 'exploration' | 'spec' | 'plan' | 'journal',
): { id: string; bodyMd: string; version: number } | null {
  if (kind === 'exploration') {
    const bodyMd = readExplorationSummarySync(projectId);
    return bodyMd ? { id: projectId, bodyMd, version: 1 } : null;
  }
  if (kind === 'spec') {
    const file = readSpecFile(projectId);
    return file ? { id: projectId, bodyMd: file.bodyMd, version: file.version } : null;
  }
  if (kind === 'plan') {
    const file = readPlanFile(projectId);
    return file ? { id: projectId, bodyMd: file.bodyMd, version: file.version } : null;
  }
  if (kind === 'journal') {
    const file = readJournalFile(projectId);
    return file ? { id: projectId, bodyMd: file.bodyMd, version: file.version } : null;
  }
  return null;
}

/** Count clean spec audit passes from details. */
function countCleanSpecAudits(details: ReturnType<typeof validateDetails>): number {
  return details.stages.spec.phases.finalize.auditPasses.filter((p) => p.status === 'clean').length;
}

/** Build the cover meta (§1a) + per-spec-section header map (F1). */
async function buildMeta(
  db: Db,
  projectId: string,
  artifactVersion: number,
): Promise<{ meta: CoverMeta; sectionHeaders: SectionHeaderMap }> {
  const [proj] = await db
    .select({ ownerId: project.ownerId, visibility: project.visibility, phase: project.phase, details: project.details })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found.`);

  const [owner] = await db
    .select({ displayName: member.displayName })
    .from(member)
    .where(eq(member.id, proj.ownerId))
    .limit(1);

  const d = proj.details ? validateDetails(proj.details) : null;
  const comps = d?.stages.spec.phases.craft.components ?? [];
  const componentsApproved = comps.filter((c) => c.approvals.length > 0).length;
  const auditClean = d ? countCleanSpecAudits(d) : 0;

  const locked = proj.phase === 'build' || proj.phase === 'learn';
  const version = `v${artifactVersion}${locked ? ' · locked' : ''}`;

  const sectionHeaders: SectionHeaderMap = {};
  comps.forEach((c, i) => {
    const hasApproval = c.approvals.length > 0;
    sectionHeaders[pad2(i + 1)] = {
      status: hasApproval ? 'Approved' : 'Gathering',
      approved: hasApproval,
      roles: '',
    };
  });

  return {
    meta: {
      owner: owner?.displayName ?? 'Unknown',
      visibility: titleCase(proj.visibility),
      componentsApproved,
      auditClean,
      version,
    },
    sectionHeaders,
  };
}

/**
 * The `Export ▾` menu model: one item per deliverable kind with ready/pending +
 * the derived locked·audited flag for the spec. Visibility-guarded (throws for a
 * non-collaborator on a private project).
 */
export async function collectMenu(
  projectId: string,
  actor: ProjectActor,
  deps: { db?: Db } = {},
): Promise<ArtifactMenuItem[]> {
  const db = deps.db ?? getDb();
  await assertProjectReadable(projectId, actor, { db });

  const [proj] = await db
    .select({ phase: project.phase, details: project.details })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found.`);

  const lockedPhase = proj.phase === 'build' || proj.phase === 'learn';
  const d = proj.details ? validateDetails(proj.details) : null;
  const cleanSpecAudits = d ? countCleanSpecAudits(d) : 0;

  const items: ArtifactMenuItem[] = [];
  for (const kind of DELIVERABLE_KINDS) {
    const art = latestArtifact(projectId, kind);
    const lockedAudited = kind === 'spec' && lockedPhase && cleanSpecAudits >= 1;
    items.push({
      kind,
      label: KIND_LABEL[kind],
      ready: art != null,
      version: art?.version ?? null,
      lockedAudited,
    });
  }
  return items;
}

/** A fully-collected artifact ready to feed the PDF/zip pipeline. */
export interface CollectedArtifact {
  kind: ExportKind;
  /** The markdown body (stored body_md, or review adapter output). */
  bodyMd: string;
  version: number | null;
  meta: CoverMeta;
  /** Spec only. */
  sectionHeaders: SectionHeaderMap;
}

/** Thrown when an artifact is requested but not ready (404/409 artifact_not_ready). */
export class ArtifactNotReadyError extends Error {
  constructor(public readonly kind: string) {
    super('artifact_not_ready');
    this.name = 'ArtifactNotReadyError';
  }
}

/**
 * Collect ONE artifact's markdown + meta for export. Visibility-guarded. Throws
 * `ArtifactNotReadyError` when the artifact is pending.
 */
export async function collectArtifact(
  projectId: string,
  kind: ExportKind,
  actor: ProjectActor,
  deps: { db?: Db } = {},
): Promise<CollectedArtifact> {
  const db = deps.db ?? getDb();
  await assertProjectReadable(projectId, actor, { db });

  const art = latestArtifact(projectId, kind);
  if (!art) throw new ArtifactNotReadyError(kind);
  const { meta, sectionHeaders } = await buildMeta(db, projectId, art.version);
  return { kind, bodyMd: art.bodyMd, version: art.version, meta, sectionHeaders };
}

/**
 * Collect ALL ready artifacts in the fixed authoring order
 * exploration→spec→plan→review (F20). Pending kinds are omitted. Used by the
 * bundle path. Visibility-guarded.
 */
export async function collectReadyArtifacts(
  projectId: string,
  actor: ProjectActor,
  deps: { db?: Db } = {},
): Promise<CollectedArtifact[]> {
  const db = deps.db ?? getDb();
  await assertProjectReadable(projectId, actor, { db });

  const out: CollectedArtifact[] = [];
  for (const kind of DELIVERABLE_KINDS) {
    try {
      out.push(await collectArtifact(projectId, kind, actor, { db }));
    } catch (e) {
      if (e instanceof ArtifactNotReadyError) continue; // pending → skip
      throw e;
    }
  }
  return out;
}
