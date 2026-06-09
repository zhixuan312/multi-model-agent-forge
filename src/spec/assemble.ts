import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { component, componentSection } from '@/db/schema/spec';
import { artifact } from '@/db/schema/artifacts';
import type { ArtifactRow } from '@/db/schema/artifacts';
import { logAction } from '@/observability/action-log';
import { templateForKind } from '@/spec/components';
import type { ComponentKind } from '@/db/enums';

/**
 * Assemble (Spec 4 / Key flow 4) — the 4a output. Concatenate approved sections,
 * in `(component.order_index, section.order_index)` order, each component's
 * `## <label>` + each section's `### <draftHeading>` + `draft_md`, prepend the
 * document header, and write `artifact(kind='spec', version=prevMax+1,
 * created_by=null)`. This single versioned spec artifact is the 4b seam input.
 */

export interface AssembleResult {
  id: string;
  version: number;
  bodyMd: string;
}

/** Build the assembled spec markdown body (pure over the loaded rows). */
export function buildSpecMarkdown(
  header: { name: string; visibility: string; version: number },
  components: Array<{
    kind: ComponentKind;
    label: string;
    sections: Array<{ key: string; label: string; draftMd: string | null }>;
  }>,
): string {
  const out: string[] = [];
  out.push(`# ${header.name} — Specification`);
  out.push('');
  out.push(`- Visibility: ${header.visibility}`);
  out.push(`- Components: ${components.map((c) => c.label).join(', ')}`);
  out.push(`- Version: ${header.version}`);
  out.push('');

  for (const comp of components) {
    out.push(`## ${comp.label}`);
    out.push('');
    const tpl = templateForKind(comp.kind);
    for (const sec of comp.sections) {
      const draftHeading = tpl.sections.find((s) => s.key === sec.key)?.draftHeading ?? sec.label;
      out.push(`### ${draftHeading}`);
      out.push('');
      out.push(sec.draftMd ?? '');
      out.push('');
    }
  }
  return out.join('\n');
}

/**
 * Assemble the spec for a project's spec stage. Loads ordered components +
 * sections, builds the markdown, and inserts a versioned `artifact(kind='spec')`.
 * Re-assemble bumps `version`.
 */
export async function assembleSpec(
  db: Db,
  projectId: string,
  stageId: string,
  actorId: string,
): Promise<AssembleResult> {
  const dbi = db ?? getDb();

  const [proj] = await dbi
    .select({ name: project.name, visibility: project.visibility })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) throw new Error(`No project '${projectId}'.`);

  const comps = await dbi
    .select({ id: component.id, kind: component.kind })
    .from(component)
    .where(eq(component.stageId, stageId))
    .orderBy(asc(component.orderIndex));

  // Next version (max+1 for this project's spec artifacts).
  const [verRow] = await dbi
    .select({ m: sql<number>`coalesce(max(${artifact.version}), 0)` })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'spec')));
  const version = (verRow?.m ?? 0) + 1;

  const componentViews = [];
  for (const comp of comps) {
    const sections = await dbi
      .select({ key: componentSection.key, label: componentSection.label, draftMd: componentSection.draftMd })
      .from(componentSection)
      .where(eq(componentSection.componentId, comp.id))
      .orderBy(asc(componentSection.orderIndex));
    const tpl = templateForKind(comp.kind as ComponentKind);
    componentViews.push({ kind: comp.kind as ComponentKind, label: tpl.label, sections });
  }

  const bodyMd = buildSpecMarkdown(
    { name: proj.name, visibility: proj.visibility, version },
    componentViews,
  );

  const [row] = await dbi
    .insert(artifact)
    .values({ projectId, kind: 'spec', bodyMd, version, createdBy: null })
    .returning({ id: artifact.id, version: artifact.version });

  await logAction(
    { projectId, memberId: actorId, action: 'assemble', target: `artifact:${row.id}` },
    dbi,
  );

  return { id: row.id, version: row.version, bodyMd };
}

/** The latest `artifact(kind='spec', version=max)` — the 4b seam input. */
export async function getLatestSpec(db: Db, projectId: string): Promise<ArtifactRow | null> {
  const dbi = db ?? getDb();
  const [row] = await dbi
    .select()
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'spec')))
    .orderBy(sql`${artifact.version} desc`)
    .limit(1);
  return row ?? null;
}
