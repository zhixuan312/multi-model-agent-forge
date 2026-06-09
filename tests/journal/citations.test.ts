import {
  extractNodeIdFromCitationFile,
  extractNodeIdsFromText,
  collectFindingCitationIds,
  resolveCitations,
  type RecallFinding,
} from '@/journal/citations';

describe('extractNodeIdFromCitationFile', () => {
  it('extracts a zero-padded id from a nodes/ path', () => {
    expect(extractNodeIdFromCitationFile('nodes/0008-foo.md')).toBe('0008');
  });
  it('extracts a bare 4-digit id token', () => {
    expect(extractNodeIdFromCitationFile('0008')).toBe('0008');
  });
  it('admits the full 4-digit range — no <1000 cap (F17)', () => {
    expect(extractNodeIdFromCitationFile('nodes/1000-foo.md')).toBe('1000');
    expect(extractNodeIdFromCitationFile('1000')).toBe('1000');
  });
  it('does NOT extract a non-citation prose token', () => {
    expect(extractNodeIdFromCitationFile('see year 2026 in the summary')).toBeNull();
    expect(extractNodeIdFromCitationFile('src/foo.ts')).toBeNull();
    expect(extractNodeIdFromCitationFile('12345')).toBeNull(); // 5 digits, not an id
  });
});

describe('extractNodeIdsFromText (real free-text evidence, F3/F17)', () => {
  it('extracts ids from nodes/ paths AND backtick-wrapped id tokens', () => {
    const ev = 'Node `0001` (`nodes/0001-derive.md`) and also `nodes/0008-keep.md` apply.';
    expect(extractNodeIdsFromText(ev)).toEqual(['0001', '0008']);
  });
  it('admits the full 4-digit range — no <1000 cap (F17)', () => {
    expect(extractNodeIdsFromText('see `nodes/1000-foo.md`')).toEqual(['1000']);
    expect(extractNodeIdsFromText('per node `1000`')).toEqual(['1000']);
  });
  it('a bare prose year (no backticks, no nodes/ path) is NOT a citation (F3)', () => {
    expect(extractNodeIdsFromText('In 2026 we adopted node-based recall.')).toEqual([]);
    expect(extractNodeIdsFromText('see line 2026 of the file')).toEqual([]);
  });
});

describe('collectFindingCitationIds (per-finding deduped chips, F4)', () => {
  it('two refs to DIFFERENT nodes → two chips', () => {
    const f: RecallFinding = {
      title: 'X',
      evidence: 'See `nodes/0008-a.md` and `nodes/0012-b.md`.',
    };
    expect(collectFindingCitationIds(f)).toEqual(['0008', '0012']);
  });
  it('two refs to the SAME node → one chip', () => {
    const f: RecallFinding = {
      title: 'X',
      evidence: 'Node `0008` per `nodes/0008-a.md` (line 1) and again `nodes/0008-a.md` (line 9).',
    };
    expect(collectFindingCitationIds(f)).toEqual(['0008']);
  });
});

describe('resolveCitations against the in-page index (F20)', () => {
  const index = [
    { id: '0008', title: 'A file-only node', status: 'adopted' },
    { id: '0012', title: 'Serialize dispatch', status: 'superseded' },
  ];
  it('resolves id → title + status', () => {
    const rows = resolveCitations(['0008', '0012'], index);
    expect(rows).toEqual([
      { id: '0008', title: 'A file-only node', status: 'adopted' },
      { id: '0012', title: 'Serialize dispatch', status: 'superseded' },
    ]);
  });
  it('unknown id → "(unknown node)"', () => {
    const rows = resolveCitations(['9999'], index);
    expect(rows).toEqual([{ id: '9999', title: '(unknown node)', status: null }]);
  });
  it('dedups ids before resolving', () => {
    const rows = resolveCitations(['0008', '0008'], index);
    expect(rows).toHaveLength(1);
  });
});
