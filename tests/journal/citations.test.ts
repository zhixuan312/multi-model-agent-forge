import {
  extractNodeIdFromCitationFile,
  resolveCitations,
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
