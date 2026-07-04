import { describe, it, expect } from 'vitest';
import { hasBlockingReviewFindings } from '@/review/review-findings';

/**
 * The code-review handler uses this to mark a review pass `revised` (needs a fix)
 * vs `clean` (advance). It must find critical/high findings wherever the envelope
 * puts them and under either severity key.
 */
describe('hasBlockingReviewFindings', () => {
  it('true when output.findings has a critical/high severity', () => {
    expect(hasBlockingReviewFindings({ output: { findings: [{ severity: 'high' }] } })).toBe(true);
    expect(hasBlockingReviewFindings({ output: { findings: [{ severity: 'critical' }] } })).toBe(true);
  });

  it('true when output.summary.findings uses the `weight` key', () => {
    expect(hasBlockingReviewFindings({ output: { summary: { findings: [{ weight: 'HIGH' }] } } })).toBe(true);
  });

  it('false when only medium/low findings', () => {
    expect(hasBlockingReviewFindings({ output: { findings: [{ severity: 'medium' }, { weight: 'low' }] } })).toBe(false);
  });

  it('false for an empty / findingless envelope', () => {
    expect(hasBlockingReviewFindings({ output: {} })).toBe(false);
    expect(hasBlockingReviewFindings({})).toBe(false);
    expect(hasBlockingReviewFindings(null)).toBe(false);
  });

  it('checks both output.findings and output.summary.findings', () => {
    expect(hasBlockingReviewFindings({ output: { findings: [{ severity: 'low' }], summary: { findings: [{ severity: 'critical' }] } } })).toBe(true);
  });
});
