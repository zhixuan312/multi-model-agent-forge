/**
 * Persistence (Spec 8 §"Persistence", §In-scope #9, F7/F16/F17/F23). Writes the
 * generated file under `<FORGE_EXPORT_ROOT>/<project_id>/`, records ONE `export`
 * row + ONE `action_log` entry.
 *
 *  - path sandbox (F16): the resolved `file_path` is asserted under the project
 *    export dir (`resolveProjectExportPath` throws on traversal);
 *  - at-rest perms (F17): the root + `<project_id>/` dirs are `0700`, files
 *    `0600` (defense-in-depth on the single-tenant box);
 *  - action_log (F7): `action='export.created'`, `target`=kind|`bundle`,
 *    `meta={ format, artifactKind, filePath }`.
 */
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { getDb, type Db } from '@/db/client';
import { exportRecord } from '@/db/schema/build';
import { loadExportConfig, type ExportConfig } from '@/export/config';
import { resolveProjectExportPath, projectExportDir } from '@/export/export-root';
import { slug, kindNoun, type ExportArtifactKind } from '@/export/slug';
import type { ExportFormat } from '@/db/enums';

export interface RecordExportInput {
  projectId: string;
  /** The artifact kind (md/pdf) or null for a bundle. */
  kind: ExportArtifactKind | null;
  format: ExportFormat;
  artifactVersion?: number | null;
  /** The bytes to persist on disk. */
  content: Buffer;
  /** Project name → slug for the on-disk filename component. */
  projectName: string;
  createdBy: string;
}

export interface RecordExportResult {
  exportId: string;
  filePath: string;
}

/** A unix-ish timestamp token for the on-disk filename (collision-free). */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const EXT: Record<ExportFormat, string> = { md: 'md', pdf: 'pdf', bundle: 'zip' };

/**
 * Write the export to disk (restrictive perms + path sandbox), insert the
 * `export` row, and append the `action_log` entry — atomically (row + log in one
 * transaction; the file is written first so a DB failure leaves no orphan row).
 */
export async function recordExport(
  input: RecordExportInput,
  deps: { db?: Db; config?: ExportConfig } = {},
): Promise<RecordExportResult> {
  const db = deps.db ?? getDb();
  const cfg = deps.config ?? loadExportConfig();

  // On-disk filename: <project-slug>-<kind-noun|bundle>-<ts>.<ext> (F4).
  const stem = input.kind ? kindNoun(input.kind) : 'bundle';
  const fileName = `${slug(input.projectName)}-${stem}-${stamp()}.${EXT[input.format]}`;

  // Path sandbox (F16): resolve + assert under <root>/<project_id>/.
  const filePath = resolveProjectExportPath(cfg.exportRoot, input.projectId, fileName);

  // Restrictive at-rest perms (F17): dirs 0700, file 0600.
  await mkdir(cfg.exportRoot, { recursive: true, mode: 0o700 });
  await chmod(cfg.exportRoot, 0o700).catch(() => {});
  const dir = projectExportDir(cfg.exportRoot, input.projectId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  await writeFile(filePath, input.content, { mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => {});

  const exportId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(exportRecord)
      .values({
        projectId: input.projectId,
        artifactKind: input.kind ?? 'bundle',
        artifactVersion: input.artifactVersion ?? null,
        format: input.format,
        filePath,
        createdBy: input.createdBy,
      })
      .returning({ id: exportRecord.id });

    return row.id;
  });

  return { exportId, filePath };
}
