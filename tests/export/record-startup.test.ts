// @vitest-environment node
import { afterAll } from 'vitest';
import { mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { exportRecord } from '@/db/schema/build';
import { actionLog } from '@/db/schema/audit';
import { recordExport } from '@/export/record';
import { runExportStartup } from '@/export/startup';
import { loadExportConfig } from '@/export/config';
import { ExportPathError } from '@/export/export-root';
import { seedProject, cleanupExportFixtures } from './db-fixtures';

afterAll(async () => {
  await cleanupExportFixtures();
});

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forge-exp-'));
}

describe('record.ts — persist + path sandbox + perms (F16/F17/F7)', () => {
  it('writes an export row + action_log entry; file lands under <root>/<project_id>/', async () => {
    const { projectId, ownerId } = await seedProject();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: tmpRoot() });

    const res = await recordExport(
      {
        projectId,
        kind: 'spec',
        format: 'pdf',
        artifactId: null,
        content: Buffer.from('%PDF-fake'),
        projectName: 'My Project',
        createdBy: ownerId,
      },
      { config: cfg },
    );

    expect(res.filePath.startsWith(join(cfg.exportRoot, projectId) + sep)).toBe(true);
    expect(existsSync(res.filePath)).toBe(true);

    const db = getDb();
    const [row] = await db.select().from(exportRecord).where(eq(exportRecord.id, res.exportId));
    expect(row.format).toBe('pdf');
    expect(row.projectId).toBe(projectId);

    const [log] = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'export.created')));
    expect(log).toBeTruthy();
    expect((log.meta as { format: string }).format).toBe('pdf');
  });

  it('a bundle row has artifact_id null and target=bundle', async () => {
    const { projectId, ownerId } = await seedProject();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: tmpRoot() });
    const res = await recordExport(
      {
        projectId,
        kind: null,
        format: 'bundle',
        artifactId: null,
        content: Buffer.from('PK fake zip'),
        projectName: 'P',
        createdBy: ownerId,
      },
      { config: cfg },
    );
    const db = getDb();
    const [row] = await db.select().from(exportRecord).where(eq(exportRecord.id, res.exportId));
    expect(row.format).toBe('bundle');
    expect(row.artifactId).toBeNull();
    const [log] = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'export.created')));
    expect(log.target).toBe('bundle');
  });

  it('created dirs are 0700 and the file is 0600 (F17)', async () => {
    const { projectId, ownerId } = await seedProject();
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });
    const res = await recordExport(
      {
        projectId,
        kind: 'spec',
        format: 'md',
        artifactId: null,
        content: Buffer.from('# md'),
        projectName: 'P',
        createdBy: ownerId,
      },
      { config: cfg },
    );
    const fileMode = statSync(res.filePath).mode & 0o777;
    const dirMode = statSync(join(root, projectId)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  it('a project name with ../ is slugified and the resolved path stays sandboxed', async () => {
    const { projectId, ownerId } = await seedProject();
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });
    const res = await recordExport(
      {
        projectId,
        kind: 'spec',
        format: 'md',
        artifactId: null,
        content: Buffer.from('x'),
        projectName: '../../etc/passwd',
        createdBy: ownerId,
      },
      { config: cfg },
    );
    // The slugged name can never escape the project dir.
    expect(res.filePath.startsWith(join(root, projectId) + sep)).toBe(true);
  });
});

describe('startup.ts — boot invariants (F6/F8/F24/F29)', () => {
  it('passes when the export root is disjoint from every repo path', async () => {
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });
    const out = await runExportStartup({
      config: cfg,
      repoPaths: async () => ['/workspace/repo-a', '/workspace/repo-b'],
      probe: async () => true,
    });
    expect(out.probeOk).toBe(true);
  });

  it('throws (fatal) when the export root overlaps a repo path', async () => {
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });
    await expect(
      runExportStartup({
        config: cfg,
        repoPaths: async () => [root], // overlap (equal)
        probe: async () => true,
      }),
    ).rejects.toBeInstanceOf(ExportPathError);
  });

  it('a failed probe is NON-fatal (logs pdf_engine_unavailable, does not throw)', async () => {
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });
    const logs: { event: string }[] = [];
    const out = await runExportStartup({
      config: cfg,
      repoPaths: async () => [],
      probe: async () => false,
      log: (e) => logs.push(e as { event: string }),
    });
    expect(out.probeOk).toBe(false);
    expect(logs.some((l) => l.event === 'pdf_engine_unavailable')).toBe(true);
  });

  it('a throwing probe is still non-fatal', async () => {
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });
    const out = await runExportStartup({
      config: cfg,
      repoPaths: async () => [],
      probe: async () => {
        throw new Error('boom');
      },
    });
    expect(out.probeOk).toBe(false);
  });
});
