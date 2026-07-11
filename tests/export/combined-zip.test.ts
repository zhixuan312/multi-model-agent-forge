// @vitest-environment node
import { buildCombinedJob, renderCombinedHtml } from '@/export/combined-html';
import { buildBundleZip, streamToBuffer } from '@/export/zip';
import type { CollectedArtifact } from '@/export/collect-artifacts';
import type { CoverMeta } from '@/export/types';

const META: CoverMeta = {
  owner: 'O',
  visibility: 'Public',
  componentsApproved: 2,
  auditClean: 1,
  version: 'v1',
};

const exploration: CollectedArtifact = {
  kind: 'exploration',
  bodyMd: '## Exploration\nexplo body',
  version: 1,
  meta: META,
  sectionHeaders: {},
};
const spec: CollectedArtifact = {
  kind: 'spec',
  bodyMd: '## 01. Context\nctx\n\n## 03. Technical design\ntech',
  version: 1,
  meta: META,
  sectionHeaders: {
    '01': { status: 'Approved', approved: true, roles: 'PM' },
    '03': { status: 'Approved', approved: true, roles: 'SWE' },
  },
};
const plan: CollectedArtifact = {
  kind: 'plan',
  bodyMd: '## Plan\nplan body',
  version: 1,
  meta: META,
  sectionHeaders: {},
};

describe('combined-html (F9/F20/F28/F32)', () => {
  it('orders artifacts exploration→spec→plan→review regardless of input order', () => {
    const html = renderCombinedHtml([plan, spec, exploration], 'Proj', false, undefined);
    expect(html.indexOf('Exploration · Forge')).toBeLessThan(html.indexOf('Specification · Forge'));
    expect(html.indexOf('Specification · Forge')).toBeLessThan(html.indexOf('Plan · Forge'));
  });

  it('inserts a divider page per artifact', () => {
    const html = renderCombinedHtml([exploration, spec], 'Proj', false, undefined);
    expect((html.match(/class="divider"/g) ?? []).length).toBe(2);
  });

  it('concatenates into ONE html document (single body)', () => {
    const html = renderCombinedHtml([exploration, spec], 'Proj', false, undefined);
    expect((html.match(/<body>/g) ?? []).length).toBe(1);
    expect((html.match(/<\/html>/g) ?? []).length).toBe(1);
  });

  it('buildCombinedJob aggregates source bytes + all section keys', () => {
    const jobObj = buildCombinedJob([exploration, spec], 'Proj', false);
    expect(jobObj.sourceBytes).toBe(
      Buffer.byteLength(exploration.bodyMd) + Buffer.byteLength(spec.bodyMd),
    );
    // spec contributes 01 + 03
    expect(jobObj.sectionKeys).toEqual(expect.arrayContaining(['01', '03']));
  });

  it('a present-but-malformed spec falls back to generic split (no throw)', () => {
    const badSpec: CollectedArtifact = { ...spec, bodyMd: 'no numbered headings' };
    const job = buildCombinedJob([exploration, badSpec], 'Proj', false);
    expect(job).toBeDefined();
  });
});

describe('zip-builder (F2)', () => {
  it('archive contains the ready .md entries + combined PDF, with expected names', async () => {
    const { stream, entryNames, fileName } = buildBundleZip({
      md: [
        { kind: 'exploration', body: 'explo' },
        { kind: 'spec', body: 'spec body' },
      ],
      combinedPdf: Buffer.from('%PDF-fake combined'),
      projectName: 'My Project',
    });
    expect(fileName).toBe('my-project.zip');
    expect(entryNames).toEqual(['exploration.md', 'specification.md', 'my-project.pdf']);

    const buf = await streamToBuffer(stream);
    // ZIP local-file-header magic + entry names appear in the central directory.
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const text = buf.toString('latin1');
    expect(text).toContain('exploration.md');
    expect(text).toContain('specification.md');
    expect(text).toContain('my-project.pdf');
  });

  it('a bundle with only exploration ready still contains the combined PDF', async () => {
    const { entryNames } = buildBundleZip({
      md: [{ kind: 'exploration', body: 'x' }],
      combinedPdf: Buffer.from('%PDF-fake'),
      projectName: 'P',
    });
    expect(entryNames).toContain('p.pdf');
    expect(entryNames.filter((n) => n.endsWith('.md'))).toEqual(['exploration.md']);
  });

  it('pending artifacts are absent (only the provided md entries appear)', async () => {
    const { entryNames } = buildBundleZip({
      md: [{ kind: 'spec', body: 'x' }],
      combinedPdf: Buffer.from('%PDF'),
      projectName: 'P',
    });
    expect(entryNames).not.toContain('plan.md');
    expect(entryNames).not.toContain('review.md');
  });

  it('the bundle stream is a Readable (not a pre-built Buffer)', () => {
    const { stream } = buildBundleZip({
      md: [],
      combinedPdf: Buffer.from('%PDF'),
      projectName: 'P',
    });
    expect(typeof (stream as { pipe?: unknown }).pipe).toBe('function');
    expect(Buffer.isBuffer(stream)).toBe(false);
  });
});
