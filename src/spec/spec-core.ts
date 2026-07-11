import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { qaMessage } from '@/db/schema/spec';
import { teamSpecTemplate, type TeamSpecTemplateRow } from '@/db/schema/team';
import { readSpecFile } from '@/projects/project-files';
import { parseSpecSections } from '@/spec/spec-file-ops';
import { templateForKind } from '@/spec/components';
import type { ComponentStatus } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import type { ComponentKind } from '@/db/enums';
import { validateDetails } from '@/details/schema';

/**
 * Spec-stage core — RSC-facing reads, lazy stage lifecycle, and intent capture.
 * Component lifecycle in `orchestrator.ts`; assemble in `assemble.ts`. Membership
 * enforced by the route/page caller via `assertProjectReadable`.
 */

/** Resolve spec stage from details. Returns status + approvers. */
export async function ensureSpecStage(db: Db, projectId: string): Promise<{ id: string; status: string; approvers: string[] }> {
  const dbi = db ?? getDb();
  const [row] = await dbi.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return { id: projectId, status: 'pending', approvers: [] };
  const d = validateDetails(row.details);
  const spec = d.stages.spec;
  if (spec.status === 'pending') {
    const { updateDetails } = await import('@/details/write');
    await updateDetails(dbi, projectId, (det) => {
      det.stages.spec.status = 'active';
      det.stages.spec.startedAt = new Date().toISOString();
      return det;
    });
  }
  return { id: projectId, status: spec.status === 'pending' ? 'active' : spec.status, approvers: spec.phases.finalize.approvals ?? [] };
}

/** Capture / update the project intent and derive the summary (pure, no LLM). */
export async function captureIntent(
  db: Db,
  projectId: string,
  intentMd: string,
  actorId: string,
): Promise<void> {
  const dbi = db ?? getDb();
  const { setBriefText } = await import('@/details/write');
  await setBriefText(dbi, projectId, intentMd);
  await logAction(
    { projectId, memberId: actorId, action: 'capture_intent', target: `project:${projectId}` },
    dbi,
  );
}

/* ── Read DTOs for the interview islands ────────────────────────────────── */

export interface SectionView {
  id: string;
  key: string;
  label: string;
  draftMd: string | null;
  orderIndex: number;
}

export interface ComponentView {
  id: string;
  kind: ComponentKind;
  label: string;
  primaryRoles: string[];
  status: ComponentStatus;
  aiSatisfied: boolean;
  humanSatisfied: boolean;
  forced: boolean;
  stale: boolean;
  approvedBy: string[];
  mmaSessionId: string | null;
  participantIds: string[];
  orderIndex: number;
  sections: SectionView[];
}

/** Load the full component/section outline for a project's spec stage, ordered.
 * Section content comes from spec.md (file = source of truth), metadata from details. */
export async function loadOutline(db: Db, _stageId: string, projectId?: string): Promise<ComponentView[]> {
  const dbi = db ?? getDb();
  if (!projectId) return [];

  const [projRow] = await dbi.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!projRow?.details) return [];
  const d = validateDetails(projRow.details);
  const comps = d.stages.spec.phases.craft.components;
  if (comps.length === 0) return [];

  const fileComponentContent: Map<string, string> = new Map();
  let specFileExists = false;
  const specFile = await readSpecFile(projectId);
  if (specFile) {
    specFileExists = true;
    const parsed = parseSpecSections(specFile.bodyMd);
    const compGroups = new Map<string, string[]>();
    for (const s of parsed) {
      const comp = s.component.toLowerCase();
      const group = compGroups.get(comp) ?? [];
      group.push(`${s.heading}\n\n${s.body}`);
      compGroups.set(comp, group);
    }
    for (const [comp, parts] of compGroups) {
      fileComponentContent.set(comp, parts.join('\n\n'));
    }
  }

  // Load templates by ID from DB
  const templateIds = comps.map((c) => c.templateId);
  const tplRows = templateIds.length > 0
    ? await dbi.select().from(teamSpecTemplate).where(inArray(teamSpecTemplate.id, templateIds))
    : [];
  const tplById = new Map(tplRows.map((r) => [r.id, r]));

  // If spec.md was deleted but components have approvals, clear them
  if (!specFileExists) {
    const hasApproved = comps.some((c) => c.approvals.length > 0);
    if (hasApproved) {
      const { updateDetails } = await import('@/details/write');
      await updateDetails(dbi, projectId, (det) => {
        for (const c of det.stages.spec.phases.craft.components) {
          c.approvals = [];
        }
        return det;
      });
      const compIds = comps.map((c) => c.id);
      if (compIds.length > 0) {
        await dbi.delete(qaMessage).where(inArray(qaMessage.targetId, compIds));
      }
    }
  }

  const views: ComponentView[] = [];
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const tpl = tplById.get(c.templateId);
    if (!tpl) continue;
    const kind = tpl.kind as ComponentKind;
    const sections = Array.isArray(tpl.sections) ? tpl.sections as Array<{ key: string; label: string }> : [];
    const hasApproval = c.approvals.length > 0;
    // Match the drafted content by the CODE label (templateForKind), because that is
    // the heading the auto-draft handler wrote into spec.md (`## <compTpl.label>`).
    // The DB `team_spec_template.label` can differ (e.g. 'Problem statement' vs
    // 'Problem', 'Risks' vs 'Risks & Mitigations'); using it here silently drops those
    // sections' drafts even though they exist in the file.
    const matchLabel = templateForKind(kind).label.toLowerCase();
    const hasDraft = specFileExists && fileComponentContent.has(matchLabel);
    const status: ComponentStatus = hasApproval ? 'approved' : (hasDraft ? 'drafted' : 'gathering');

    views.push({
      id: c.id,
      kind,
      label: tpl.label,
      primaryRoles: [],
      status,
      aiSatisfied: hasDraft,
      humanSatisfied: hasApproval,
      forced: false,
      stale: false,
      approvedBy: [...c.approvals],
      mmaSessionId: null,
      // Invited reviewers are stored spec-level (the /spec/invite route pushes to
      // spec.participants). Surface them on every component so the invite persists
      // across refresh — previously hardcoded [], so invited members vanished on the
      // post-invite SSE re-seed.
      participantIds: d.stages.spec.participants ?? [],
      orderIndex: i,
      sections: sections.map((s, si) => ({
        id: `${c.id}-${s.key}`,
        key: s.key,
        label: s.label,
        draftMd: si === 0
          ? fileComponentContent.get(matchLabel) ?? null
          : null,
        orderIndex: si,
      })),
    });
  }
  return views;
}

/** The repaint payload returned by the nod handler. */
export interface SectionRepaint {
  component: {
    status: ComponentStatus;
    aiSatisfied: boolean;
    humanSatisfied: boolean;
    forced: boolean;
    stale: boolean;
  };
  qaMessages: Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string }>;
}

/** Build the repaint payload for a component after a mutation. */
export async function buildSectionRepaint(db: Db, sectionId: string): Promise<SectionRepaint> {
  const dbi = db ?? getDb();
  // sectionId is `{componentId}-{sectionKey}` — extract componentId
  const componentId = sectionId.includes('-') ? sectionId.slice(0, 36) : sectionId;

  // Find the project that has this component in details
  const rows = await dbi.select({ id: project.id, details: project.details }).from(project);
  for (const r of rows) {
    if (!r.details) continue;
    const d = validateDetails(r.details);
    const comp = d.stages.spec.phases.craft.components.find((c) => c.id === componentId);
    if (comp) {
      const hasApproval = comp.approvals.length > 0;
      return {
        component: {
          status: hasApproval ? 'approved' : 'gathering',
          aiSatisfied: true,
          humanSatisfied: hasApproval,
          forced: false,
          stale: false,
        },
        qaMessages: await loadComponentMessages(dbi, componentId),
      };
    }
  }
  throw new Error(`No component '${componentId}' found in any project details.`);
}

/** Load all qa_messages for every component in a project, keyed by componentId. */
export async function loadAllMessages(
  db: Db,
  _stageId: string,
  projectId?: string,
): Promise<Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId: string | null }>>> {
  if (!projectId) return {};
  const rows = await db
    .select({ id: qaMessage.id, targetId: qaMessage.targetId, bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId })
    .from(qaMessage)
    .where(eq(qaMessage.projectId, projectId))
    .orderBy(qaMessage.seq);
  const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
  const result: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId: string | null }>> = {};
  for (const r of rows) {
    if (!r.targetId) continue;
    const sender = r.authorId === FORGE_MEMBER_ID ? 'forge' : 'member';
    const list = result[r.targetId] ?? [];
    list.push({ id: r.id, sender: sender as 'forge' | 'member', bodyMd: r.bodyMd, authorId: r.authorId });
    result[r.targetId] = list;
  }
  return result;
}

export async function loadComponentMessages(
  db: Db,
  componentId: string,
): Promise<Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string }>> {
  const dbi = db ?? getDb();
  const { FORGE_MEMBER_ID } = await import('@/automation/forge-member');
  const rows = await dbi
    .select({ id: qaMessage.id, bodyMd: qaMessage.bodyMd, authorId: qaMessage.authorId })
    .from(qaMessage)
    .where(eq(qaMessage.targetId, componentId))
    .orderBy(asc(qaMessage.seq));
  return rows.map((r) => ({
    id: r.id,
    sender: (r.authorId === FORGE_MEMBER_ID ? 'forge' : 'member') as 'forge' | 'member',
    bodyMd: r.bodyMd,
  }));
}
