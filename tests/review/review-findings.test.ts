import { describe, it, expect } from 'vitest';
import { extractReviewFindings, hasBlockingReviewFindings, buildReviewFixPrompt } from '@/review/review-findings';

/**
 * The shape below is the MEASURED contract, not an assumed one: across 37 real
 * `code-review` envelopes in the batch store, findings sat at `output.summary.findings[]`
 * under a `weight` key (31 of them; the other 6 carried no findings), while
 * `output.findings`, a `severity` key, and a string-valued `summary` each occurred zero
 * times. The parse still tolerates those, but they are tolerance, not the contract.
 */
const envelope = (findings: unknown[]) => ({ output: { summary: { findings } } });

describe('extractReviewFindings', () => {
  it('reads the real envelope shape and preserves order + fields', () => {
    const out = extractReviewFindings(envelope([
      { weight: 'high', category: 'bug', claim: 'A', file: 'a.ts', line: 3, evidence: 'e', suggestion: 's' },
      { weight: 'low', category: 'style', claim: 'B' },
    ]));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ weight: 'high', claim: 'A', file: 'a.ts', line: 3 });
    // Order is load-bearing: the review page's checkbox index maps 1:1 to the finding the
    // fix worker is then told to apply.
    expect(out[1].claim).toBe('B');
  });

  it('defaults a missing weight to medium and missing strings to empty', () => {
    const [f] = extractReviewFindings(envelope([{ claim: 'no severity given' }]));
    expect(f).toMatchObject({ weight: 'medium', category: '', file: '', line: 0 });
  });

  it('tolerates a JSON-string summary, fenced or bare', () => {
    const body = JSON.stringify({ findings: [{ weight: 'critical', claim: 'X' }] });
    expect(extractReviewFindings({ output: { summary: body } })[0].weight).toBe('critical');
    expect(extractReviewFindings({ output: { summary: '```json\n' + body + '\n```' } })[0].weight).toBe('critical');
  });

  it('returns [] for an unparseable or empty envelope rather than throwing', () => {
    expect(extractReviewFindings({ output: { summary: 'not json at all' } })).toEqual([]);
    expect(extractReviewFindings({ output: {} })).toEqual([]);
    expect(extractReviewFindings({})).toEqual([]);
    expect(extractReviewFindings(null)).toEqual([]);
  });
});

describe('hasBlockingReviewFindings — the gate reads exactly what the UI reads', () => {
  it('blocks on critical or high, case-insensitively', () => {
    expect(hasBlockingReviewFindings(envelope([{ weight: 'high' }]))).toBe(true);
    expect(hasBlockingReviewFindings(envelope([{ weight: 'CRITICAL' }]))).toBe(true);
  });

  it('does not block on medium/low, or on no findings at all', () => {
    expect(hasBlockingReviewFindings(envelope([{ weight: 'medium' }, { weight: 'low' }]))).toBe(false);
    expect(hasBlockingReviewFindings(envelope([]))).toBe(false);
    expect(hasBlockingReviewFindings(null)).toBe(false);
  });

  it('agrees with extractReviewFindings on the SAME envelope — the drift this prevents', () => {
    // The two used to parse independently: the gate accepted `output.findings` and a
    // `severity` key, the display path accepted neither. A pass could therefore be gated
    // as blocking while the review page and the fix prompt both labelled it "medium".
    const e = envelope([{ weight: 'critical', claim: 'Null deref' }]);
    expect(hasBlockingReviewFindings(e)).toBe(true);
    expect(extractReviewFindings(e)[0].weight).toBe('critical');
    expect(buildReviewFixPrompt(extractReviewFindings(e))).toContain('[critical]');
  });

  it('accepts `severity` as an alias, so the one parse is no stricter than the two it replaced', () => {
    expect(hasBlockingReviewFindings(envelope([{ severity: 'high' }]))).toBe(true);
    expect(extractReviewFindings(envelope([{ severity: 'high' }]))[0].weight).toBe('high');
  });
});

describe('buildReviewFixPrompt', () => {
  it('numbers findings and includes file:line and the suggestion', () => {
    const prompt = buildReviewFixPrompt(extractReviewFindings(envelope([
      { weight: 'high', claim: 'Guard the call', file: 'a.ts', line: 12, suggestion: 'add a null check' },
    ])));
    expect(prompt).toContain('1. [high] a.ts:12 — Guard the call');
    expect(prompt).toContain('Suggested fix: add a null check');
  });

  it('says so explicitly when a finding carries no file', () => {
    const prompt = buildReviewFixPrompt(extractReviewFindings(envelope([{ weight: 'low', claim: 'C' }])));
    expect(prompt).toContain('(no file given)');
  });
});
