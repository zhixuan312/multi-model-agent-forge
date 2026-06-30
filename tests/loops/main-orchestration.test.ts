// @vitest-environment node
import { parsePlan, parseJournal, planPrompt, journalPrompt, PLAN_OUTPUT_FORMAT, JOURNAL_OUTPUT_FORMAT } from '@/loops/main-orchestration';

describe('parsePlan', () => {
  it('parses a clean plan object', () => {
    const out = parsePlan('{"recalls":[{"query":"prior hygiene runs","purpose":"avoid repeats"}],"verifyCommand":"npm test"}');
    expect(out).toEqual({ recalls: [{ query: 'prior hygiene runs', purpose: 'avoid repeats' }], verifyCommand: 'npm test' });
  });
  it('tolerates a code fence + surrounding prose', () => {
    const raw = 'Here is the plan:\n```json\n{"recalls":[],"verifyCommand":null}\n```\nDone.';
    expect(parsePlan(raw)).toEqual({ recalls: [], verifyCommand: null });
  });
  it('defaults missing fields and returns null on garbage', () => {
    expect(parsePlan('{}')).toEqual({ recalls: [], verifyCommand: null });
    expect(parsePlan('not json at all')).toBeNull();
    expect(parsePlan('{"verifyCommand":123}')).toBeNull();
  });
});

describe('parseJournal', () => {
  it('parses entries with valid tags', () => {
    const out = parseJournal('{"entries":[{"tag":"learned","text":"x"},{"tag":"missed","text":"y"}]}');
    expect(out?.entries).toHaveLength(2);
    expect(out?.entries[0]).toEqual({ tag: 'learned', text: 'x' });
  });
  it('accepts an empty list and rejects bad tags', () => {
    expect(parseJournal('{"entries":[]}')).toEqual({ entries: [] });
    expect(parseJournal('{"entries":[{"tag":"done","text":"x"}]}')).toBeNull();
  });
});

describe('prompts', () => {
  it('plan prompt embeds the goal and demands JSON-only', () => {
    const p = planPrompt('keep docs current');
    expect(p).toContain('keep docs current');
    expect(p).toContain('recalls');
    expect(p).toContain('verifyCommand');
    expect(p).toMatch(/ONLY a single JSON object/i);
    expect(PLAN_OUTPUT_FORMAT).toContain('verifyCommand');
  });
  it('journal prompt forbids "done"-style entries and shows the verify outcome', () => {
    const p = journalPrompt({ goalMd: 'g', workerSummary: 's', filesChanged: ['a.ts'], verify: { command: 'npm test', passed: false, detail: 'failed' } });
    expect(p).toContain('`npm test` → FAIL (failed)');
    expect(p).toMatch(/NOT .*(done|task completed)/i);
    expect(JOURNAL_OUTPUT_FORMAT).toContain('entries');
  });
});
