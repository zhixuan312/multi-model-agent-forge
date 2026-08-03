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

  // An unnumbered spec is the NORMAL case, not a malformed one — mma-spec emits
  // `## <component>`, and no spec artifact on disk uses the numbered form. Asserts the
  // job's contents rather than `toBeDefined()`: not throwing is a weaker claim than the
  // fallback actually yielding a renderable section.
  it('an unnumbered spec still contributes its content to the combined job', () => {
    const badSpec: CollectedArtifact = { ...spec, bodyMd: 'no numbered headings' };
    const job = buildCombinedJob([exploration, badSpec], 'Proj', false);
    expect(job.sourceBytes).toBe(
      Buffer.byteLength(exploration.bodyMd) + Buffer.byteLength(badSpec.bodyMd),
    );
    expect(job.sectionKeys.length).toBeGreaterThan(0);
    expect(job.buildHtml(undefined)).toContain('no numbered headings');
  });
});

describe('zip-builder (F2)', () => {
  /**
   * Read the names back out of the ARCHIVE, not out of a list the builder assembled
   * beside its `append` calls. That list was the previous assertion target, and it
   * would have reported an entry whose append never happened.
   */
  async function entriesOf(stream: Parameters<typeof streamToBuffer>[0]): Promise<string[]> {
    const buf = await streamToBuffer(stream);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    // Central-directory headers (PK\x01\x02): 46-byte fixed part, then the name.
    const names: string[] = [];
    for (let i = 0; i + 46 <= buf.length; i++) {
      if (buf.readUInt32LE(i) !== 0x02014b50) continue;
      const nameLen = buf.readUInt16LE(i + 28);
      names.push(buf.subarray(i + 46, i + 46 + nameLen).toString('utf8'));
    }
    return names;
  }

  it('archive contains the ready .md entries + combined PDF, with expected names', async () => {
    const { stream, fileName } = buildBundleZip({
      md: [
        { kind: 'exploration', body: 'explo' },
        { kind: 'spec', body: 'spec body' },
      ],
      combinedPdf: Buffer.from('%PDF-fake combined'),
      projectName: 'My Project',
    });
    expect(fileName).toBe('my-project.zip');
    expect(await entriesOf(stream)).toEqual([
      'exploration.md',
      'specification.md',
      'my-project.pdf',
    ]);
  });

  it('a bundle with only exploration ready still contains the combined PDF', async () => {
    const { stream } = buildBundleZip({
      md: [{ kind: 'exploration', body: 'x' }],
      combinedPdf: Buffer.from('%PDF-fake'),
      projectName: 'P',
    });
    const names = await entriesOf(stream);
    expect(names).toContain('p.pdf');
    expect(names.filter((n) => n.endsWith('.md'))).toEqual(['exploration.md']);
  });

  it('pending artifacts are absent (only the provided md entries appear)', async () => {
    const { stream } = buildBundleZip({
      md: [{ kind: 'spec', body: 'x' }],
      combinedPdf: Buffer.from('%PDF'),
      projectName: 'P',
    });
    const names = await entriesOf(stream);
    expect(names).toEqual(['specification.md', 'p.pdf']);
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
