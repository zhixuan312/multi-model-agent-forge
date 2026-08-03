// @vitest-environment node
/**
 * ONE PDF engine.
 *
 * `exportPdf` and `exportBundle` must render through the SAME `PdfRenderer`. They
 * did not. `exportBundle` used the shared renderer; `exportPdf` used it only when a
 * test injected `deps.renderer`, and in production spawned a standalone worker
 * script instead. That second engine applied none of the renderer's caps
 * (`FORGE_PDF_MAX_SOURCE_BYTES` → 413, `FORGE_PDF_MAX_QUEUE` → 503, the per-render
 * timeout → 504), never ran the two-pass TOC measure, and called `page.pdf()` with
 * neither `displayHeaderFooter` nor the template's margins. Measured against the
 * running app, the downloaded spec PDF had NO footer, NO project name and a Contents
 * page whose page-number cells were all blank — while `render-pdf.test.ts` asserted
 * the footer was present, because every test injected `deps.renderer` and therefore
 * exercised the other implementation.
 *
 * So this file does not test rendering. It tests that the production call path
 * reaches the shared renderer at all, and hands it a job carrying the inputs the
 * caps and the TOC measure need.
 */
import { vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockDb, seq } from '../test-utils/mock-db';
import type { RenderJob } from '@/export/pdf/render';
import type { ProjectActor } from '@/projects/projects-core';

let mockDb = createMockDb();

vi.mock('@/db/client', () => ({
  getDb: () => mockDb,
  getSql: () => ({}),
}));

const readSpecFileMock = vi.fn<(id: string) => import('@/projects/project-files').SpecFile | null>();
vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return { ...orig, readSpecFile: (...args: [string]) => readSpecFileMock(...args) };
});

// recordExport writes the rendered bytes to disk; keep that inside a temp dir.
process.env.FORGE_EXPORT_ROOT = mkdtempSync(join(tmpdir(), 'forge-engine-'));

const { exportPdf, exportBundle } = await import('@/export/service');
const { getPdfRenderer } = await import('@/export/pdf/render');

const OWNER = 'member-1';
const PROJECT = 'proj-1';
const SPEC_BODY = '## 01. Context\nctx\n\n## 03. Technical design\ntech';
const ACTOR: ProjectActor = { id: OWNER, teamId: 'team-1' };

/** A project row wide enough for every consumer (the mock ignores the column list). */
const PROJECT_ROW = {
  ownerId: OWNER,
  visibility: 'public',
  phase: 'design',
  details: null,
  name: 'My Project',
  summary: 'A one-line lede.',
  intentMd: null,
};

beforeEach(() => {
  readSpecFileMock.mockReset();
  readSpecFileMock.mockReturnValue({ version: 1, updatedAt: '', bodyMd: SPEC_BODY });
  mockDb = createMockDb({
    'select:project_participant': [{ memberId: OWNER }],
    // assertProjectReadable → buildMeta → projectName → projectLede
    'select:project': seq([PROJECT_ROW], [PROJECT_ROW], [PROJECT_ROW], [PROJECT_ROW]),
    'select:team_member': [{ displayName: 'Owner' }],
    'select:project_audit_pass': [],
    'select:project_artifact': [],
    'select:ops_mma_batch': [],
    'insert:project_export': [{ id: 'exp-1' }],
  });
});

/** Capture the jobs the shared renderer is asked to run, without launching Chromium. */
function captureJobs(): { jobs: RenderJob[]; restore: () => void } {
  const jobs: RenderJob[] = [];
  const spy = vi.spyOn(getPdfRenderer(), 'render').mockImplementation(async (job: RenderJob) => {
    jobs.push(job);
    return Buffer.from('%PDF-stub');
  });
  return { jobs, restore: () => spy.mockRestore() };
}

describe('export — a single PDF engine', () => {
  it('exportPdf renders through the shared PdfRenderer when no renderer is injected', async () => {
    const { jobs, restore } = captureJobs();
    try {
      const out = await exportPdf(PROJECT, 'spec', { mermaidAsDiagram: false }, ACTOR);
      expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      restore();
    }
    // The whole point: production reached the shared engine. A second engine would
    // leave this empty while the export still "succeeded".
    expect(jobs).toHaveLength(1);
  });

  it('exportBundle renders through that same shared PdfRenderer', async () => {
    const { jobs, restore } = captureJobs();
    try {
      await exportBundle(PROJECT, { mermaidAsDiagram: false }, ACTOR);
    } finally {
      restore();
    }
    expect(jobs).toHaveLength(1);
  });

  it('hands the single-artifact job the inputs the caps and the TOC measure need', async () => {
    const { jobs, restore } = captureJobs();
    try {
      await exportPdf(PROJECT, 'spec', { mermaidAsDiagram: false }, ACTOR);
    } finally {
      restore();
    }
    const job = jobs[0]!;

    // Without sourceBytes the FORGE_PDF_MAX_SOURCE_BYTES cap (413) cannot fire.
    expect(job.sourceBytes).toBe(Buffer.byteLength(SPEC_BODY));
    // Without sectionKeys the two-pass measure has nothing to look for, so every
    // Contents cell stays blank — which is exactly what shipped.
    expect(job.sectionKeys).toEqual(['01', '03']);
    // The footer names the project; a job with no project name renders it empty.
    expect(job.projectName).toBe('My Project');
  });

  it('the job builds the Forge template on both passes — blank cells, then measured ones', async () => {
    const { jobs, restore } = captureJobs();
    try {
      await exportPdf(PROJECT, 'spec', { mermaidAsDiagram: false }, ACTOR);
    } finally {
      restore();
    }
    const buildHtml = jobs[0]!.buildHtml;

    // Pass 1: no ranges yet, so the Contents cells are empty…
    expect(buildHtml(undefined)).not.toMatch(/p\.\d/);
    // …and pass 2 fills them from the measure. A single-page section renders `p.N`,
    // a section that overflows renders `p.N–M`.
    const pass2 = buildHtml({ '01': { startPage: 2, endPage: 2 }, '03': { startPage: 3, endPage: 5 } });
    expect(pass2).toContain('p.2');
    expect(pass2).toContain('p.3–5');
  });
});
