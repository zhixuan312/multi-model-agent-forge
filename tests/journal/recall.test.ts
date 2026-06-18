import { parseRecallEnvelope, dispatchRecall } from '@/journal/recall';
import type { MmaClient } from '@/mma/client';

/** Wrap a worker answer object as the live envelope: a ```json block in summary. */
function envWith(answer: unknown) {
  return {
    headline: 'recall complete',
    structuredReport: {
      summary: '```json\n' + JSON.stringify(answer) + '\n```',
      workerStatus: 'done',
      filesChanged: [],
    },
  };
}

describe('parseRecallEnvelope (live refiner envelope shape, verified 2026-06-18)', () => {
  it('parses results[] + summary out of the structuredReport.summary JSON block', () => {
    const env = envWith({
      results: [
        {
          learning: 'Completion is gated by objective lifecycle signals',
          context: 'Refines nodes/0008; supersedes the self-report gate.',
          relevance: 'critical',
          nodeId: '0001',
          nodePath: 'nodes/0001-derive-completion.md',
          category: 'decision',
          status: 'adopted',
        },
        {
          learning: 'One canonical read path per lifecycle fact',
          context: 'Depends on 0001.',
          relevance: 'high',
          nodeId: '0008',
          nodePath: 'nodes/0008-keep-one-read-path.md',
          category: 'design',
          status: 'adopted',
        },
      ],
      summary: 'We gate completion on objective signals and keep one read path.',
    });
    const r = parseRecallEnvelope(env);
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]!.learning).toBe('Completion is gated by objective lifecycle signals');
    expect(r.findings[0]!.relevance).toBe('critical');
    expect(r.findings[0]!.status).toBe('adopted');
    expect(r.citationIds).toEqual(['0001', '0008']);
    expect(r.summary).toBe('We gate completion on objective signals and keep one read path.');
  });

  it('normalizes a nodeId given as a nodes/000X-….md path', () => {
    const env = envWith({
      results: [{ learning: 'x', context: 'c', relevance: 'low', nodeId: 'nodes/0042-foo.md', nodePath: 'nodes/0042-foo.md', category: 'process', status: 'adopted' }],
      summary: 's',
    });
    expect(parseRecallEnvelope(env).citationIds).toEqual(['0042']);
  });

  it('empty results → no findings, recall-miss summary when the worker summary is blank', () => {
    const env = envWith({ results: [], summary: '' });
    const r = parseRecallEnvelope(env);
    expect(r.findings).toEqual([]);
    expect(r.citationIds).toEqual([]);
    expect(r.summary).toBe('No relevant prior learnings.');
  });

  it('keeps a real worker summary even with no results', () => {
    const env = envWith({ results: [], summary: 'No prior learnings on this topic.' });
    expect(parseRecallEnvelope(env).summary).toBe('No prior learnings on this topic.');
  });

  it('dedupes citation ids across results, first-seen order', () => {
    const env = envWith({
      results: [
        { learning: 'a', context: 'c', relevance: 'high', nodeId: '0005', nodePath: 'p', category: 'design', status: 'adopted' },
        { learning: 'b', context: 'c', relevance: 'low', nodeId: '0005', nodePath: 'p', category: 'design', status: 'adopted' },
        { learning: 'c', context: 'c', relevance: 'low', nodeId: '0002', nodePath: 'p', category: 'design', status: 'adopted' },
      ],
      summary: 's',
    });
    expect(parseRecallEnvelope(env).citationIds).toEqual(['0005', '0002']);
  });

  it('falls back to the implementer draft when the refiner returns no findings (auth/path failure)', () => {
    const real = {
      results: [{ learning: 'The graph store is the authority', context: 'c', relevance: 'critical', nodeId: '0035', nodePath: 'nodes/0035-x.md', category: 'decision', status: 'adopted' }],
      summary: 'The journal graph store is the canonical authority.',
    };
    // Refiner over-rejected everything (wrong journal path → "all hallucinated");
    // the implementer's real draft is preserved at results[0].report.implementer.
    const env = {
      structuredReport: { summary: 'No journal nodes exist at .mma/journal/nodes/. All cited entries are hallucinated and have been removed.' },
      results: [{ report: { implementer: '```json\n' + JSON.stringify(real) + '\n```', reviewer: null } }],
    };
    const r = parseRecallEnvelope(env);
    expect(r.findings).toHaveLength(1);
    expect(r.citationIds).toEqual(['0035']);
    expect(r.summary).toBe('The journal graph store is the canonical authority.');
  });

  it('prefers the refiner answer when it DID refine (has findings)', () => {
    const refined = { results: [{ learning: 'L', context: 'c', relevance: 'high', nodeId: '0001', nodePath: 'p', category: 'design', status: 'adopted' }], summary: 'refined' };
    const draft = { results: [{ learning: 'D', context: 'c', relevance: 'low', nodeId: '0009', nodePath: 'p', category: 'design', status: 'adopted' }], summary: 'draft' };
    const env = {
      structuredReport: { summary: '```json\n' + JSON.stringify(refined) + '\n```' },
      results: [{ report: { implementer: '```json\n' + JSON.stringify(draft) + '\n```' } }],
    };
    const r = parseRecallEnvelope(env);
    expect(r.summary).toBe('refined');
    expect(r.citationIds).toEqual(['0001']);
  });

  it('tolerates a missing / malformed envelope without throwing', () => {
    expect(parseRecallEnvelope({}).findings).toEqual([]);
    expect(parseRecallEnvelope(null).findings).toEqual([]);
    expect(parseRecallEnvelope({}).summary).toBe('No relevant prior learnings.');
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
