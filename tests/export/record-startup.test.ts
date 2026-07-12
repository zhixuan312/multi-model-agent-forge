// @vitest-environment node
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { recordExport } from '@/export/record';
import { runExportStartup } from '@/export/startup';
import { loadExportConfig } from '@/export/config';
import { ExportPathError } from '@/export/export-root';
import { createMockDb } from '../test-utils/mock-db';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forge-exp-'));
}

describe('record.ts — persist + path sandbox + perms (F16/F17/F7)', () => {
  it('writes an export row; file lands under <root>/<project_id>/', async () => {
    const projectId = 'proj-1';
    const createdBy = 'member-1';
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: tmpRoot() });

    const db = createMockDb({
      'insert:project_export': [{ id: 'exp-1' }],
    });

    const res = await recordExport(
      {
        projectId,
        kind: 'spec',
        format: 'pdf',
        artifactVersion: null,
        content: Buffer.from('%PDF-fake'),
        projectName: 'My Project',
        createdBy,
      },
      { config: cfg, db },
    );

    expect(res.filePath.startsWith(join(cfg.exportRoot, projectId) + sep)).toBe(true);
    expect(db._assertCalled('project_export', 'insert')).toBe(true);

    const insertCalls = db._callsFor('project_export');
    const valueCall = insertCalls.find((c) => c.method === 'values');
    expect(JSON.stringify(valueCall?.args)).toContain('pdf');
    expect(JSON.stringify(valueCall?.args)).toContain(projectId);
  });

  it('a bundle row has artifactKind=bundle and artifactVersion null', async () => {
    const projectId = 'proj-1';
    const createdBy = 'member-1';
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: tmpRoot() });

    const db = createMockDb({
      'insert:project_export': [{ id: 'exp-1' }],
    });

    await recordExport(
      {
        projectId,
        kind: null,
        format: 'bundle',
        artifactVersion: null,
        content: Buffer.from('PK fake zip'),
        projectName: 'P',
        createdBy,
      },
      { config: cfg, db },
    );

    expect(db._assertCalled('project_export', 'insert')).toBe(true);
    const insertCalls = db._callsFor('project_export');
    const valueCall = insertCalls.find((c) => c.method === 'values');
    expect(valueCall?.args).toEqual([
      expect.objectContaining({
        artifactKind: 'bundle',
        artifactVersion: null,
        format: 'bundle',
        projectId,
      }),
    ]);
  });

  it('created dirs are 0700 and the file is 0600 (F17)', async () => {
    const projectId = 'proj-1';
    const createdBy = 'member-1';
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });

    const db = createMockDb({
      'insert:project_export': [{ id: 'exp-1' }],
    });

    const res = await recordExport(
      {
        projectId,
        kind: 'spec',
        format: 'md',
        artifactVersion: null,
        content: Buffer.from('# md'),
        projectName: 'P',
        createdBy,
      },
      { config: cfg, db },
    );

    expect(res.filePath.startsWith(join(root, projectId) + sep)).toBe(true);
    const fileMode = statSync(res.filePath).mode & 0o777;
    const dirMode = statSync(join(root, projectId)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  it('a project name with ../ is slugified and the resolved path stays sandboxed', async () => {
    const projectId = 'proj-1';
    const createdBy = 'member-1';
    const root = tmpRoot();
    const cfg = loadExportConfig({ FORGE_EXPORT_ROOT: root });

    const db = createMockDb({
      'insert:project_export': [{ id: 'exp-1' }],
    });

    const res = await recordExport(
      {
        projectId,
        kind: 'spec',
        format: 'md',
        artifactVersion: null,
        content: Buffer.from('x'),
        projectName: '../../etc/passwd',
        createdBy,
      },
      { config: cfg, db },
    );

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
        repoPaths: async () => [root],
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
