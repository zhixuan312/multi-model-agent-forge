/**
 * Export service orchestration (Spec 8 Key flows B/C/D). Thin functions the
 * route handlers call: collect → sections → render → record. Keeps the routes
 * free of pipeline wiring and lets the flow unit-test against injected deps.
 */
import { getPdfRenderer, artifactRenderJob, type PdfRenderer } from '@/export/pdf/render';
import { parseArtifactSections } from '@/export/sections';
import { renderArtifactHtml } from '@/export/pdf/template';
import { spawnPdfRender } from '@/export/pdf/spawn-render';
import { slug } from '@/export/slug';
import {
  collectArtifact,
  collectReadyArtifacts,
  type CollectedArtifact,
} from '@/export/collect-artifacts';
import { buildCombinedJob } from '@/export/combined-html';
import { buildBundleZip, streamToBuffer } from '@/export/zip';
import { buildMdExport } from '@/export/md-export';
import { recordExport } from '@/export/record';
import type { ProjectActor } from '@/projects/projects-core';
import type { ExportKind } from '@/export/types';

/** Bundle with nothing ready (409 nothing_to_export). */
export class NothingToExportError extends Error {
  constructor() {
    super('nothing_to_export');
    this.name = 'NothingToExportError';
  }
}

export interface ServiceDeps {
  renderer?: PdfRenderer;
}

/** Resolve a project's display name (for slugs + footer). */
async function projectName(projectId: string): Promise<string> {
  const { getDb } = await import('@/db/client');
  const { project } = await import('@/db/schema/projects');
  const { eq } = await import('drizzle-orm');
  const [row] = await getDb()
    .select({ name: project.name })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return row?.name ?? 'Project';
}

/** Lede = project.summary || project.intent_md || ''. */
async function projectLede(projectId: string): Promise<string> {
  const { getDb } = await import('@/db/client');
  const { project } = await import('@/db/schema/projects');
  const { eq } = await import('drizzle-orm');
  const [row] = await getDb()
    .select({ summary: project.summary, intentMd: project.intentMd })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  return row?.summary ?? row?.intentMd ?? '';
}

/* ── B. single .md ──────────────────────────────────────────────────────── */

export interface MdDownload {
  fileName: string;
  body: string;
  exportId: string;
}

export async function exportMd(
  projectId: string,
  kind: ExportKind,
  actor: ProjectActor,
): Promise<MdDownload> {
  const collected = await collectArtifact(projectId, kind, actor);
  const md = buildMdExport(kind, collected.bodyMd);
  const name = await projectName(projectId);
  const { exportId } = await recordExport({
    projectId,
    kind,
    format: 'md',
    artifactVersion: null,
    content: md.buffer,
    projectName: name,
    createdBy: actor.id,
  });
  return { fileName: md.fileName, body: md.body, exportId };
}

/* ── C. single PDF ──────────────────────────────────────────────────────── */

export interface PdfDownload {
  fileName: string;
  buffer: Buffer;
  exportId: string;
}

export async function exportPdf(
  projectId: string,
  kind: ExportKind,
  opts: { mermaidAsDiagram: boolean },
  actor: ProjectActor,
  deps: ServiceDeps = {},
): Promise<PdfDownload> {
  const collected = await collectArtifact(projectId, kind, actor);
  // Parse (spec fails loud on zero `## NN.`). Every export is the WHOLE artifact —
  // section selection was removed with the PDF dialog it belonged to.
  const sections = parseArtifactSections(collected.bodyMd, kind);

  const name = await projectName(projectId);
  const lede = await projectLede(projectId);

  let buffer: Buffer;
  if (deps.renderer) {
    // Test injection — use in-process renderer
    buffer = await deps.renderer.render(
      artifactRenderJob(
        { kind, projectName: name, lede, meta: collected.meta, sections, sectionHeaders: collected.sectionHeaders, mermaidAsDiagram: opts.mermaidAsDiagram },
        Buffer.byteLength(collected.bodyMd),
      ),
    );
  } else {
    // Production: spawn subprocess to avoid Turbopack ESM issues with puppeteer
    const html = renderArtifactHtml({ kind, projectName: name, lede, meta: collected.meta, sections, sectionHeaders: collected.sectionHeaders, mermaidAsDiagram: opts.mermaidAsDiagram });
    buffer = await spawnPdfRender(html, { mermaidAsDiagram: opts.mermaidAsDiagram });
  }

  const { exportId } = await recordExport({
    projectId,
    kind,
    format: 'pdf',
    artifactVersion: null,
    content: buffer,
    projectName: name,
    createdBy: actor.id,
  });
  return { fileName: `${slug(name)}-${kind}.pdf`, buffer, exportId };
}

/* ── D. bundle (.zip) ───────────────────────────────────────────────────── */

export interface BundleResult {
  fileName: string;
  zip: Buffer;
  entryNames: string[];
  /** Included artifact kinds (for the toast). */
  includedKinds: ExportKind[];
  exportId: string;
}

export async function exportBundle(
  projectId: string,
  opts: { mermaidAsDiagram: boolean },
  actor: ProjectActor,
  deps: ServiceDeps = {},
): Promise<BundleResult> {
  const ready: CollectedArtifact[] = await collectReadyArtifacts(projectId, actor);
  if (ready.length === 0) throw new NothingToExportError();

  const name = await projectName(projectId);
  const renderer = deps.renderer ?? getPdfRenderer();

  // Combined PDF (throws SpecHeadingContractError on a malformed present spec, F32).
  const combinedPdf = await renderer.render(buildCombinedJob(ready, name, opts.mermaidAsDiagram));

  const { stream, entryNames, fileName, done } = buildBundleZip({
    md: ready.map((a) => ({ kind: a.kind, body: a.bodyMd })),
    combinedPdf,
    projectName: name,
  });
  const zip = await streamToBuffer(stream);
  await done.catch(() => {});

  const { exportId } = await recordExport({
    projectId,
    kind: null,
    format: 'bundle',
    artifactVersion: null,
    content: zip,
    projectName: name,
    createdBy: actor.id,
  });

  return {
    fileName,
    zip,
    entryNames,
    includedKinds: ready.map((a) => a.kind),
    exportId,
  };
}
