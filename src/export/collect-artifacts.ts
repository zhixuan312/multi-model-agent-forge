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
 *    `project.phase ∈ {build,done}` AND ≥1 `audit_pass{spec,clean}`.
 *  - COVER META (§1a): owner / visibility / components-N-approved /
 *    audit-clean-N / version (+ `· locked`).
 *  - PER-SECTION HEADER MAP (F1): for the spec, `NN → {status, roles}` from the
 *    spec-stage `component` rows (NN = order_index+1, zero-padded).
 *  - REVIEW→MARKDOWN adapter (F25): normalize the review batch result.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { readExplorationSummary as readExplorationSummarySync, readSpecFile } from '@/projects/project-files';
import { auditPass } from '@/db/schema/artifacts';
import { component } from '@/db/schema/spec';
import { mmaBatch } from '@/db/schema/mma';
import { project, stage } from '@/db/schema/projects';
import { member } from '@/db/schema/identity';
import { assertProjectReadable, type ProjectActor } from '@/projects/projects-core';
import { reviewResultToMarkdown } from '@/export/review-adapter';
import type { CoverMeta, ExportKind, SectionHeaderMap } from '@/export/types';

export type { ExportKind };

const DELIVERABLE_KINDS: ExportKind[] = ['exploration', 'spec', 'plan', 'review'];

const KIND_LABEL: Record<ExportKind, string> = {
  exploration: 'Exploration summary',
  spec: 'Specification',
  plan: 'Plan',
  review: 'Review report',
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

/** Latest artifact for a deliverable kind. Exploration and spec read from file; plan from DB. */
async function latestArtifact(
  db: Db,
  projectId: string,
  kind: 'exploration' | 'spec' | 'plan',
): Promise<{ id: string; bodyMd: string; version: number } | null> {
  if (kind === 'exploration') {
    const bodyMd = readExplorationSummarySync(projectId);
    return bodyMd ? { id: projectId, bodyMd, version: 1 } : null;
  }
  if (kind === 'spec') {
    const file = readSpecFile(projectId);
    return file ? { id: projectId, bodyMd: file.bodyMd, version: file.version } : null;
  }
  const [row] = await db
    .select({ id: artifact.id, bodyMd: artifact.bodyMd, version: artifact.version })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, kind)))
    .orderBy(desc(artifact.version))
    .limit(1);
  return row ?? null;
}

/** The latest DONE review batch result for a project (Spec 7 exposure). */
async function latestReviewResult(db: Db, projectId: string): Promise<unknown | null> {
  const [row] = await db
    .select({ result: mmaBatch.result })
    .from(mmaBatch)
    .where(and(eq(mmaBatch.projectId, projectId), eq(mmaBatch.route, 'review'), eq(mmaBatch.status, 'done')))
    .orderBy(desc(mmaBatch.createdAt))
    .limit(1);
  return row?.result ?? null;
}

/** Count `audit_pass{scope='spec', verdict='clean'}` for a project. */
async function countCleanSpecAudits(db: Db, projectId: string): Promise<number> {
  const rows = await db
    .select({ id: auditPass.id })
    .from(auditPass)
    .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec'), eq(auditPass.verdict, 'clean')));
  return rows.length;
}

/** The spec-stage `component` rows, ordered by order_index. */
async function specComponents(
  db: Db,
  projectId: string,
): Promise<{ status: string; roles: string[]; orderIndex: number }[]> {
  const [specStage] = await db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')))
    .limit(1);
  if (!specStage) return [];
  const rows = await db
    .select({ status: component.status, roles: component.primaryRoles, orderIndex: component.orderIndex })
    .from(component)
    .where(eq(component.stageId, specStage.id))
    .orderBy(component.orderIndex);
  return rows.map((r) => ({ status: r.status, roles: r.roles, orderIndex: r.orderIndex }));
}

/** Build the cover meta (§1a) + per-spec-section header map (F1). */
async function buildMeta(
  db: Db,
  projectId: string,
  artifactVersion: number,
): Promise<{ meta: CoverMeta; sectionHeaders: SectionHeaderMap }> {
  const [proj] = await db
    .select({ ownerId: project.ownerId, visibility: project.visibility, phase: project.phase })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found.`);

  const [owner] = await db
    .select({ displayName: member.displayName })
    .from(member)
    .where(eq(member.id, proj.ownerId))
    .limit(1);

  const comps = await specComponents(db, projectId);
  const componentsApproved = comps.filter((c) => c.status === 'approved').length;
  const auditClean = await countCleanSpecAudits(db, projectId);

  const locked = proj.phase === 'build' || proj.phase === 'learn';
  const version = `v${artifactVersion}${locked ? ' · locked' : ''}`;

  const sectionHeaders: SectionHeaderMap = {};
  comps.forEach((c, i) => {
    sectionHeaders[pad2(i + 1)] = {
      status: titleCase(c.status),
      approved: c.status === 'approved',
      roles: c.roles.join(' · '),
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
    .select({ phase: project.phase })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found.`);

  const lockedPhase = proj.phase === 'build' || proj.phase === 'learn';
  const cleanSpecAudits = await countCleanSpecAudits(db, projectId);

  const items: ArtifactMenuItem[] = [];
  for (const kind of DELIVERABLE_KINDS) {
    if (kind === 'review') {
      const result = await latestReviewResult(db, projectId);
      items.push({ kind, label: KIND_LABEL[kind], ready: result != null, version: null, lockedAudited: false });
      continue;
    }
    const art = await latestArtifact(db, projectId, kind);
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

  if (kind === 'review') {
    const result = await latestReviewResult(db, projectId);
    if (result == null) throw new ArtifactNotReadyError('review');
    const bodyMd = reviewResultToMarkdown(result);
    // Review has no artifact version; meta version reads the latest artifact present
    // for the project's locked suffix — but with no stored artifact, default to v1.
    const { meta, sectionHeaders } = await buildMeta(db, projectId, 1);
    return { kind, bodyMd, version: null, meta, sectionHeaders };
  }

  const art = await latestArtifact(db, projectId, kind);
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
