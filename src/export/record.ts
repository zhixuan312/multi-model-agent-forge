/**
 * Persistence (Spec 8 §"Persistence", §In-scope #9, F16/F17/F23). Writes the
 * generated file under `<FORGE_EXPORT_ROOT>/<project_id>/` and records ONE
 * `project_export` row.
 *
 *  - path sandbox (F16): the resolved `file_path` is asserted under the project
 *    export dir (`resolveProjectExportPath` throws on traversal);
 *  - at-rest perms (F17): the root + `<project_id>/` dirs are `0700`, files
 *    `0600` (defense-in-depth on the single-tenant box).
 *
 * NOT recorded: an audit entry. This header used to specify one — an `action_log`
 * row with `action='export.created'`, a `target`, and a `meta` payload — down to
 * the field names, and the code has never written it. There is no `action_log`
 * table in the schema, and nothing appends to `project_activity` here either, so
 * an export leaves no trace on the project timeline. Adding one is a product
 * decision (it needs a stage/phase to file under); until then this says so rather
 * than describing a row that does not exist.
 */
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { getDb, type Db } from '@/db/client';
import { exportRecord } from '@/db/schema/build';
import { loadExportConfig, type ExportConfig } from '@/export/config';
import { resolveProjectExportPath, projectExportDir } from '@/export/export-root';
import { slug, kindNoun } from '@/export/slug';
import type { ExportKind } from '@/export/types';
import type { ExportFormat } from '@/db/enums';

export interface RecordExportInput {
  projectId: string;
  /** The artifact kind (md/pdf) or null for a bundle. */
  kind: ExportKind | null;
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
 * Write the export to disk (restrictive perms + path sandbox), then insert the
 * `project_export` row. The file is written first, so a DB failure leaves a
 * stray file rather than a row pointing at nothing.
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

  // One statement, so no transaction: the wrapper here existed to pair this insert
  // with the audit-log insert described above, which was never written.
  const [row] = await db
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

  return { exportId: row.id, filePath };
}
