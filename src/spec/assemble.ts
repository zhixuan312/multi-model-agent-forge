import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { component, componentSection } from '@/db/schema/spec';
import { logAction } from '@/observability/action-log';
import { templateForKind } from '@/spec/components';
import { readSpecFileAsync, writeSpecAsync } from '@/projects/project-files';
import type { ComponentKind } from '@/db/enums';

/**
 * Assemble — concatenate component sections into a single spec markdown file.
 * Ordered by `(component.order_index, section.order_index)`, each component's
 * `## <label>` + each section's `### <draftHeading>` + `draft_md`. Written to
 * the physical `spec.md` file with YAML frontmatter (version + timestamp).
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
    const skipSectionHeading = comp.sections.length === 1
      && (tpl.sections[0]?.draftHeading ?? comp.sections[0].label) === comp.label;
    for (const sec of comp.sections) {
      if (!skipSectionHeading) {
        const draftHeading = tpl.sections.find((s) => s.key === sec.key)?.draftHeading ?? sec.label;
        out.push(`### ${draftHeading}`);
        out.push('');
      }
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

  const prev = await readSpecFileAsync(projectId);
  const version = (prev?.version ?? 0) + 1;

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

  const { version: savedVersion } = await writeSpecAsync(projectId, bodyMd);

  await logAction(
    { projectId, memberId: actorId, action: 'assemble', target: `spec:v${savedVersion}` },
    dbi,
  );

  return { id: projectId, version: savedVersion, bodyMd };
}

/** The latest spec from disk — file-based, not DB. */
export async function getLatestSpec(_db: unknown, projectId: string): Promise<{ version: number; bodyMd: string } | null> {
  const file = await readSpecFileAsync(projectId);
  if (!file) return null;
  return { version: file.version, bodyMd: file.bodyMd };
}
