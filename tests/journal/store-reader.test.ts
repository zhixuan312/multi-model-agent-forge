// @vitest-environment node
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  journalDirFor,
  assertInsideJournalDir,
  parseFrontmatter,
  parseIndexRow,
  parseLogLine,
  extractCrux,
  readIndex,
  readLog,
  readAllNodes,
  readNode,
  computeInbound,
  INVERSE_LABEL,
} from '@/journal/store-reader';
import { FIXTURE_ROOT } from './fixtures';

describe('journal parse helpers', () => {
  it('parses a real-shaped node: block-sequence tags/links + Context/Consequences', () => {
    const raw = [
      '---',
      'id: "0002"',
      'title: "Prefer parallel dispatch"',
      'status: "adopted"',
      'tags:',
      '  - concurrency',
      '  - dispatch',
      'timestamp: "2026-05-24"',
      'links:',
      '  - type: "supersedes"',
      '    target: "0001"',
      '  - type: "relates"',
      '    target: "0003"',
      'supersededBy: null',
      '---',
      '',
      '## Context',
      'Body context.',
      '',
      '## Consequences',
      'Body consequences.',
      '',
    ].join('\n');
    const r = parseFrontmatter(raw, '0002-foo.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.node;
    expect(n.id).toBe('0002');
    expect(n.title).toBe('Prefer parallel dispatch');
    expect(n.status).toBe('adopted');
    expect(n.tags).toEqual(['concurrency', 'dispatch']);
    expect(n.timestamp).toBe('2026-05-24');
    expect(n.links).toEqual([
      { type: 'supersedes', target: '0001' },
      { type: 'relates', target: '0003' },
    ]);
    expect(n.supersededBy).toBeNull();
    expect(n.context).toContain('Body context.');
    expect(n.consequences).toContain('Body consequences.');
  });

  it('accepts unquoted scalars, inline-flow tags, and the `to:` link-target key', () => {
    const raw = [
      '---',
      'id: "0003"',
      'title: Investigate flaky poll timeouts',
      'status: inconclusive',
      'tags: [polling, flaky, timeouts]',
      'timestamp: 2026-05-25',
      'links:',
      '  - type: relates',
      '    to: "0001"',
      'supersededBy: null',
      '---',
      '## Context',
      'c',
      '## Consequences',
      'q',
    ].join('\n');
    const r = parseFrontmatter(raw, '0003-foo.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.status).toBe('inconclusive');
    expect(r.node.tags).toEqual(['polling', 'flaky', 'timeouts']);
    expect(r.node.links).toEqual([{ type: 'relates', target: '0001' }]);
  });

  it('preserves a recognized node with an unknown status/edge value (not skipped)', () => {
    const raw = [
      '---',
      'id: "0005"',
      'title: "Unknown status"',
      'status: "frobnicated"',
      'tags:',
      '  - x',
      'timestamp: "2026-05-27"',
      'links:',
      '  - type: "wobbles"',
      '    target: "0002"',
      'supersededBy: null',
      '---',
      '## Context',
      'c',
      '## Consequences',
      'q',
    ].join('\n');
    const r = parseFrontmatter(raw, '0005-foo.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.status).toBe('frobnicated');
    expect(r.node.links[0]!.type).toBe('wobbles');
  });

  it('returns a parse-error marker for an unparseable node (no frontmatter)', () => {
    const r = parseFrontmatter('just some text, no frontmatter', '0006-broken.md');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.filename).toBe('0006-broken.md');
    expect(r.error.id).toBe('0006');
  });

  it('crux: first non-heading line before ## Context becomes crux; straight-into-Context → null', () => {
    const withCrux = 'Fix the dangerous op precisely.\n\n## Context\nbody\n## Consequences\nq';
    expect(extractCrux(withCrux)).toBe('Fix the dangerous op precisely.');
    const noCrux = '## Context\nbody\n## Consequences\nq';
    expect(extractCrux(noCrux)).toBeNull();
  });

  it('parseIndexRow splits the comma-separated tags cell; skips header/separator (OKF 6-col)', () => {
    expect(parseIndexRow('| id | timestamp | type | status | title | tags |')).toBeNull();
    expect(parseIndexRow('| --- | --- | --- | --- | --- | --- |')).toBeNull();
    const row = parseIndexRow('| 0003 | 2026-05-25 | process | inconclusive | Flaky timeouts | polling, flaky, timeouts |');
    expect(row).toEqual({
      id: '0003',
      timestamp: '2026-05-25',
      type: 'process',
      status: 'inconclusive',
      title: 'Flaky timeouts',
      tags: ['polling', 'flaky', 'timeouts'],
    });
  });

  it('parseLogLine reads timestamp · op · id · title (multi-space delimited)', () => {
    const e = parseLogLine('2026-05-24T00:00:00+08:00  create  0001  Serialize dispatch');
    expect(e).toEqual({
      timestamp: '2026-05-24T00:00:00+08:00',
      op: 'create',
      id: '0001',
      title: 'Serialize dispatch',
    });
    expect(parseLogLine('   ')).toBeNull();
  });
});

describe('confinement', () => {
  it('rejects a target that escapes the journal dir', () => {
    const dir = journalDirFor(FIXTURE_ROOT);
    expect(() => assertInsideJournalDir(dir, join(dir, '0001-x.md'))).not.toThrow();
    expect(() => assertInsideJournalDir(dir, join(dir, '..', '..', 'etc', 'passwd'))).toThrow();
  });

  it('rejects a symlink that escapes the journal dir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'jrnl-'));
    const jdir = join(tmp, '.mma', 'journal');
    mkdirSync(join(jdir, 'nodes'), { recursive: true });
    const secret = join(tmp, 'secret.md');
    writeFileSync(secret, 'top secret');
    const link = join(jdir, 'nodes', 'escape.md');
    symlinkSync(secret, link);
    expect(() => assertInsideJournalDir(jdir, link)).toThrow();
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('readers against the fixture journal', () => {
  it('readIndex parses every node row', async () => {
    const rows = await readIndex(FIXTURE_ROOT);
    expect(rows.map((r) => r.id)).toContain('0001');
    expect(rows.find((r) => r.id === '0003')!.tags).toEqual(['polling', 'flaky', 'timeouts']);
  });

  it('readAllNodes is the source of truth: file-only listed, index-only flagged missing', async () => {
    const res = await readAllNodes(FIXTURE_ROOT);
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const ids = res.nodes.map((n) => n.id);
    // 0008 is file-only (absent from index) but must be listed.
    expect(ids).toContain('0008');
    // 0009 is index-only (file missing) but still listed, flagged missing.
    const ghost = res.nodes.find((n) => n.id === '0009');
    expect(ghost?.fileMissing).toBe(true);
    // 0006 is unparseable → skipped, counted.
    expect(ids).not.toContain('0006');
    expect(res.skippedCount).toBe(1);
    // 0005 (unknown status) is NOT skipped.
    expect(ids).toContain('0005');
  });

  it('readAllNodes does NOT ship link data on the client summaries', async () => {
    const res = await readAllNodes(FIXTURE_ROOT);
    if (res.kind !== 'ok') return;
    const n = res.nodes.find((x) => x.id === '0002')!;
    expect(n).not.toHaveProperty('links');
    expect(n).not.toHaveProperty('context');
  });

  it('readNode returns one node body lazily', async () => {
    const n = await readNode(FIXTURE_ROOT, '0002');
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.node.context).toContain('parallel');
    expect(n.node.crux).toBe('Fix the dangerous operation precisely rather than sacrificing concurrency.');
  });

  it('readNode on an unparseable node returns a parse error (no throw)', async () => {
    const n = await readNode(FIXTURE_ROOT, '0006');
    expect(n.ok).toBe(false);
  });

  it('readLog parses every line', async () => {
    const log = await readLog(FIXTURE_ROOT);
    expect(log.length).toBe(7);
    expect(log[0]).toMatchObject({ op: 'create', id: '0001' });
    // unknown op preserved verbatim (renderer handles neutral display)
    expect(log.find((l) => l.id === '0008')!.op).toBe('archive');
  });
});

describe('inbound-edge inversion', () => {
  it('inverts forward edges via the label table + supersededBy', async () => {
    const res = await readAllNodesFrontmatter();
    // node 0001 is superseded by 0002 (0002 supersedes 0001) AND 0001.supersededBy=0002
    const inboundTo1 = computeInbound(res, '0001');
    expect(inboundTo1).toContainEqual({ label: 'superseded-by', source: '0002' });
    // 0002 depends-on 0004 → inbound to 0004 is required-by
    const inboundTo4 = computeInbound(res, '0004');
    expect(inboundTo4).toContainEqual({ label: 'required-by', source: '0002' });
    // 0004 parent→0002 means 0002 has an inbound child edge
    const inboundTo2 = computeInbound(res, '0002');
    expect(inboundTo2).toContainEqual({ label: 'child', source: '0004' });
    // an unknown forward type (0005 wobbles→0002) inverts to its raw label
    expect(inboundTo2).toContainEqual({ label: 'wobbles', source: '0005' });
    // relates is symmetric
    const inboundTo3 = computeInbound(res, '0003');
    expect(inboundTo3.some((e) => e.label === 'relates' && e.source === '0002')).toBe(true);
    // contradicts symmetric: 0004 contradicts 0003
    expect(inboundTo3).toContainEqual({ label: 'contradicts', source: '0004' });
  });

  it('INVERSE_LABEL covers every known edge type', () => {
    expect(INVERSE_LABEL.supersedes).toBe('superseded-by');
    expect(INVERSE_LABEL.refines).toBe('refined-by');
    expect(INVERSE_LABEL.relates).toBe('relates');
    expect(INVERSE_LABEL['depends-on']).toBe('required-by');
    expect(INVERSE_LABEL.contradicts).toBe('contradicts');
    expect(INVERSE_LABEL.parent).toBe('child');
  });

  // helper: read every node's full frontmatter (links included) for inbound calc
  async function readAllNodesFrontmatter() {
    const { readNodeFrontmatters } = await import('@/journal/store-reader');
    return readNodeFrontmatters(FIXTURE_ROOT);
  }
});

describe('graceful empty / missing / EACCES', () => {
  it('missing journal dir → empty outcome (no throw)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'jrnl-empty-'));
    const res = await readAllNodes(tmp);
    expect(res.kind).toBe('empty');
    expect(await readLog(tmp)).toEqual([]);
    expect(await readIndex(tmp)).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('present-but-unreadable journal dir → unreadable outcome (no throw to 500)', async () => {
    if (process.getuid && process.getuid() === 0) return; // root bypasses perms
    const tmp = mkdtempSync(join(tmpdir(), 'jrnl-eacces-'));
    const jdir = join(tmp, '.mma', 'journal');
    mkdirSync(join(jdir, 'nodes'), { recursive: true });
    writeFileSync(join(jdir, 'index.md'), '| id | date | status | title | tags |\n');
    chmodSync(jdir, 0o000);
    try {
      const res = await readAllNodes(tmp);
      expect(res.kind).toBe('unreadable');
    } finally {
      chmodSync(jdir, 0o755);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
