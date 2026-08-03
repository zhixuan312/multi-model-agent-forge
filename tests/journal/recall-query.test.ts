// @vitest-environment node
/**
 * The bounds lived in two places that had to agree: the recall route (two `if`s and their
 * 400 messages) and `RecallTab` (a `canSubmit` expression plus a second copy inside `run()`).
 * The client's copy decides whether the button is enabled; the server's decides whether the
 * request is honoured — the same two-sided asymmetry the loop-activity filter had against its
 * own `?status=` validator, where the dropdown offered a value the server rejected.
 */
import { checkRecallQuery, RECALL_QUERY_MIN, RECALL_QUERY_MAX } from '@/journal/recall-query';

describe('checkRecallQuery', () => {
  it('accepts a query at each end of the range', () => {
    expect(checkRecallQuery('x'.repeat(RECALL_QUERY_MIN)).ok).toBe(true);
    expect(checkRecallQuery('x'.repeat(RECALL_QUERY_MAX)).ok).toBe(true);
  });

  it('rejects one character short and one character long', () => {
    expect(checkRecallQuery('x'.repeat(RECALL_QUERY_MIN - 1)).ok).toBe(false);
    expect(checkRecallQuery('x'.repeat(RECALL_QUERY_MAX + 1)).ok).toBe(false);
  });

  it('measures the TRIMMED query, so padding cannot carry it over the minimum', () => {
    const padded = `   ${'x'.repeat(RECALL_QUERY_MIN - 1)}   `;
    expect(padded.length).toBeGreaterThan(RECALL_QUERY_MIN);
    expect(checkRecallQuery(padded).ok).toBe(false);
  });

  it('returns the trimmed query, so both callers dispatch the same text', () => {
    const res = checkRecallQuery('  how do we structure settings tabs?  ');
    expect(res.ok && res.query).toBe('how do we structure settings tabs?');
  });

  it('names the bound it failed, so the message can be shown as-is', () => {
    const short = checkRecallQuery('hi');
    expect(short.ok).toBe(false);
    expect(!short.ok && short.message).toContain(String(RECALL_QUERY_MIN));
  });

  it('is a real range, not a placeholder', () => {
    expect(RECALL_QUERY_MIN).toBeGreaterThan(0);
    expect(RECALL_QUERY_MAX).toBeGreaterThan(RECALL_QUERY_MIN);
  });
});
