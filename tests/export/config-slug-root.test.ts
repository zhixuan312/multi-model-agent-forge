// @vitest-environment node
import { resolve, join, sep } from 'node:path';
import { loadExportConfig, resolveExportRootPath } from '@/export/config';
import { slug, kindNoun, mdFileName } from '@/export/slug';
import {
  assertExportRootDisjoint,
  resolveProjectExportPath,
  projectExportDir,
  ExportPathError,
} from '@/export/export-root';

describe('export config (F33)', () => {
  it('defaults all knobs when env is empty', () => {
    const c = loadExportConfig({});
    expect(c.pdfTimeoutMs).toBe(30_000);
    expect(c.pdfMaxSourceBytes).toBe(5_242_880);
    expect(c.pdfMaxQueue).toBe(8);
    expect(c.pdfNoSandbox).toBe(true);
    expect(c.puppeteerExecutablePath).toBeNull();
    expect(c.exportRoot).toBe(join(process.cwd(), '.forge-exports'));
  });

  it('parses positive-int numerics from strings', () => {
    const c = loadExportConfig({
      FORGE_PDF_TIMEOUT_MS: '5000',
      FORGE_PDF_MAX_SOURCE_BYTES: '1024',
      FORGE_PDF_MAX_QUEUE: '3',
    });
    expect(c.pdfTimeoutMs).toBe(5000);
    expect(c.pdfMaxSourceBytes).toBe(1024);
    expect(c.pdfMaxQueue).toBe(3);
  });

  it('rejects non-positive / non-int numerics', () => {
    expect(() => loadExportConfig({ FORGE_PDF_TIMEOUT_MS: '0' })).toThrow();
    expect(() => loadExportConfig({ FORGE_PDF_MAX_QUEUE: '-1' })).toThrow();
    expect(() => loadExportConfig({ FORGE_PDF_MAX_QUEUE: '2.5' })).toThrow();
  });

  it('FORGE_PDF_NO_SANDBOX accepts false-ish strings', () => {
    expect(loadExportConfig({ FORGE_PDF_NO_SANDBOX: 'false' }).pdfNoSandbox).toBe(false);
    expect(loadExportConfig({ FORGE_PDF_NO_SANDBOX: '0' }).pdfNoSandbox).toBe(false);
    expect(loadExportConfig({ FORGE_PDF_NO_SANDBOX: 'true' }).pdfNoSandbox).toBe(true);
  });

  it('resolveExportRootPath honors absolute + relative env', () => {
    expect(resolveExportRootPath('/abs/exports')).toBe('/abs/exports');
    expect(resolveExportRootPath('rel/exports')).toBe(resolve(process.cwd(), 'rel/exports'));
  });
});

describe('slug (F4)', () => {
  it('matches the spec examples exactly', () => {
    expect(slug('My Project: v2')).toBe('my-project-v2');
    expect(slug('  Über/Repo  ')).toBe('uber-repo');
    expect(slug('…')).toBe('untitled');
    expect(slug('')).toBe('untitled');
  });

  it('truncates to 60 chars and re-trims a trailing dash', () => {
    const long = 'a'.repeat(70);
    expect(slug(long)).toHaveLength(60);
    // a name that would leave a trailing dash at the cut boundary
    const withDash = 'x'.repeat(59) + ' y'; // 59 x, dash at index 59, then y
    const out = slug(withDash);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('-')).toBe(false);
  });

  it('kind→noun map and md filenames', () => {
    expect(kindNoun('spec')).toBe('specification');
    expect(kindNoun('exploration')).toBe('exploration');
    expect(kindNoun('plan')).toBe('plan');
    expect(kindNoun('journal')).toBe('journal');
    expect(mdFileName('spec')).toBe('specification.md');
    expect(mdFileName('journal')).toBe('journal.md');
  });
});

describe('export-root invariants (F16/F23)', () => {
  it('assertExportRootDisjoint passes for truly-disjoint paths', () => {
    expect(() =>
      assertExportRootDisjoint('/srv/forge/.forge-exports', ['/workspace/repo-a', '/workspace/repo-b']),
    ).not.toThrow();
  });

  it('throws when the export root sits inside a repo tree', () => {
    expect(() =>
      assertExportRootDisjoint('/workspace/repo-a/.forge-exports', ['/workspace/repo-a']),
    ).toThrow(ExportPathError);
  });

  it('throws when a repo tree sits inside the export root', () => {
    expect(() =>
      assertExportRootDisjoint('/workspace', ['/workspace/repo-a']),
    ).toThrow(ExportPathError);
  });

  it('throws when the export root equals a repo path', () => {
    expect(() => assertExportRootDisjoint('/workspace/r', ['/workspace/r'])).toThrow(ExportPathError);
  });

  it('ignores blank repo paths', () => {
    expect(() => assertExportRootDisjoint('/srv/exports', ['', '   '])).not.toThrow();
  });

  it('resolveProjectExportPath keeps a normal filename under the project dir', () => {
    const root = '/srv/exports';
    const pid = 'proj-1';
    const p = resolveProjectExportPath(root, pid, 'specification.md');
    expect(p).toBe(join(projectExportDir(root, pid), 'specification.md'));
    expect(p.startsWith(projectExportDir(root, pid) + sep)).toBe(true);
  });

  it('rejects a traversal filename (../)', () => {
    expect(() => resolveProjectExportPath('/srv/exports', 'proj-1', '../escape.md')).toThrow(ExportPathError);
    expect(() => resolveProjectExportPath('/srv/exports', 'proj-1', '../../etc/passwd')).toThrow(ExportPathError);
  });

  it('rejects a NUL-byte filename', () => {
    expect(() => resolveProjectExportPath('/srv/exports', 'proj-1', 'a\0b.md')).toThrow(ExportPathError);
  });
});
