import { parseRecallEnvelope, dispatchRecall } from '@/journal/recall';
import type { MmaClient } from '@/mma/client';

describe('parseRecallEnvelope (REAL live envelope shape, verified 2026-06-09)', () => {
  it('reads structuredReport.findings[] and extracts ids from evidence text', () => {
    const env = {
      headline: 'recall complete',
      structuredReport: {
        summary: '2 finding(s)', // a bare count, not prose
        findings: [
          {
            severity: 'critical',
            category: 'completion-gating',
            claim: 'Completion is gated by objective lifecycle signals',
            evidence: 'Node `0001` (`nodes/0001-derive-completion.md`) is canonical.',
            suggestion: 'check the gate path',
          },
          {
            severity: 'high',
            category: 'read-paths',
            claim: 'One canonical read path per lifecycle fact',
            evidence: 'See `nodes/0008-keep-one-read-path.md`.',
            suggestion: '',
          },
        ],
      },
      results: [{ taskId: 'x:0', route: 'journal-recall', status: 'done' }], // batch meta, NOT findings
    };
    const r = parseRecallEnvelope(env);
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]!.claim).toBe('Completion is gated by objective lifecycle signals');
    expect(r.findings[0]!.category).toBe('completion-gating');
    expect(r.citationIds).toEqual(['0001', '0008']);
    // the count summary is replaced by a composed synthesis from the claims
    expect(r.summary).toContain('Completion is gated by objective lifecycle signals');
  });

  it('a year embedded in evidence prose is NOT a citation (negative — F3)', () => {
    const env = {
      structuredReport: {
        summary: '1 finding(s)',
        findings: [{ claim: 'x', evidence: 'In 2026 we adopted node-based recall.' }],
      },
    };
    expect(parseRecallEnvelope(env).citationIds).toEqual([]);
  });

  it('prefers a real prose summary over a composed one', () => {
    const env = {
      structuredReport: {
        summary: 'We gate completion on objective signals.',
        findings: [{ claim: 'c', evidence: '`nodes/0001-x.md`' }],
      },
    };
    expect(parseRecallEnvelope(env).summary).toBe('We gate completion on objective signals.');
  });

  it('recall-miss / empty journal → no findings, recall-miss summary, no error', () => {
    const env = { structuredReport: { summary: '0 finding(s)', findings: [] } };
    const r = parseRecallEnvelope(env);
    expect(r.findings).toEqual([]);
    expect(r.citationIds).toEqual([]);
    expect(r.summary).toBe('No relevant prior learnings.');
  });

  it('tolerates a missing structuredReport / findings', () => {
    expect(parseRecallEnvelope({}).findings).toEqual([]);
    expect(parseRecallEnvelope(null).findings).toEqual([]);
  });
});

describe('dispatchRecall', () => {
  it('calls MmaClient.journalRecall with the workspace root as cwd', async () => {
    const calls: { cwd: string; query: string }[] = [];
    const client = {
      journalRecall: async (cwd: string, input: { query: string }) => {
        calls.push({ cwd, query: input.query });
        return { batchId: 'b-1' };
      },
    } as unknown as MmaClient;
    const out = await dispatchRecall(client, '/workspace', 'how do we gate completion?');
    expect(out).toEqual({ batchId: 'b-1' });
    expect(calls).toEqual([{ cwd: '/workspace', query: 'how do we gate completion?' }]);
  });
});
