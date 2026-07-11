import { parseRecallEnvelope } from '@/journal/recall';

/**
 * Wrap a recall answer as the v5.4 terminal envelope. For journal_recall,
 * `output.summary` is an already-parsed object `{ answer, findings, criteriaCovered }`;
 * each finding uses v5.4 fields `{ claim, evidence, weight, nodeId, nodePath, category }`.
 */
function envWith(summary: {
  answer: string;
  findings?: Array<Record<string, unknown>>;
  criteriaCovered?: string[];
}) {
  return {
    output: {
      summary: {
        answer: summary.answer,
        findings: summary.findings ?? [],
        criteriaCovered: summary.criteriaCovered ?? [],
      },
    },
  };
}

describe('parseRecallEnvelope (v5.4 terminal envelope shape)', () => {
  it('parses findings[] + answer out of output.summary', () => {
    const env = envWith({
      answer: 'We gate completion on objective signals and keep one read path.',
      findings: [
        {
          claim: 'Completion is gated by objective lifecycle signals',
          evidence: 'Refines nodes/0008; supersedes the self-report gate.',
          weight: 'critical',
          nodeId: '0001',
          nodePath: 'nodes/0001-derive-completion.md',
          category: 'decision',
          status: 'adopted',
        },
        {
          claim: 'One canonical read path per lifecycle fact',
          evidence: 'Depends on 0001.',
          weight: 'high',
          nodeId: '0008',
          nodePath: 'nodes/0008-keep-one-read-path.md',
          category: 'design',
          status: 'adopted',
        },
      ],
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
      answer: 's',
      findings: [{ claim: 'x', evidence: 'c', weight: 'low', nodeId: 'nodes/0042-foo.md', nodePath: 'nodes/0042-foo.md', category: 'process', status: 'adopted' }],
    });
    expect(parseRecallEnvelope(env).citationIds).toEqual(['0042']);
  });

  it('empty findings → no findings, recall-miss summary when the answer is blank', () => {
    const env = envWith({ answer: '', findings: [] });
    const r = parseRecallEnvelope(env);
    expect(r.findings).toEqual([]);
    expect(r.citationIds).toEqual([]);
    expect(r.summary).toBe('No relevant prior learnings.');
  });

  it('keeps a real answer even with no findings', () => {
    const env = envWith({ answer: 'No prior learnings on this topic.', findings: [] });
    expect(parseRecallEnvelope(env).summary).toBe('No prior learnings on this topic.');
  });

  it('dedupes citation ids across findings, first-seen order', () => {
    const env = envWith({
      answer: 's',
      findings: [
        { claim: 'a', evidence: 'c', weight: 'high', nodeId: '0005', nodePath: 'p', category: 'design', status: 'adopted' },
        { claim: 'b', evidence: 'c', weight: 'low', nodeId: '0005', nodePath: 'p', category: 'design', status: 'adopted' },
        { claim: 'c', evidence: 'c', weight: 'low', nodeId: '0002', nodePath: 'p', category: 'design', status: 'adopted' },
      ],
    });
    expect(parseRecallEnvelope(env).citationIds).toEqual(['0005', '0002']);
  });

  it('falls back to the implementer draft when the refiner returns no findings (auth/path failure)', () => {
    const real = {
      results: [{ claim: 'The graph store is the authority', evidence: 'c', weight: 'critical', nodeId: '0035', nodePath: 'nodes/0035-x.md', category: 'decision', status: 'adopted' }],
      summary: 'The journal graph store is the canonical authority.',
    };
    // Refiner over-rejected everything (wrong journal path → "all hallucinated");
    // the implementer's real draft is preserved at raw.implementer.
    const env = {
      output: { summary: { answer: 'No journal nodes exist at .mma/journal/nodes/. All cited entries are hallucinated and have been removed.', findings: [] } },
      raw: { implementer: '```json\n' + JSON.stringify(real) + '\n```' },
    };
    const r = parseRecallEnvelope(env);
    expect(r.findings).toHaveLength(1);
    expect(r.citationIds).toEqual(['0035']);
    expect(r.summary).toBe('The journal graph store is the canonical authority.');
  });

  it('prefers the refiner answer when it DID refine (has findings)', () => {
    const refinedFindings = [{ claim: 'L', evidence: 'c', weight: 'high', nodeId: '0001', nodePath: 'p', category: 'design', status: 'adopted' }];
    const draft = { results: [{ claim: 'D', evidence: 'c', weight: 'low', nodeId: '0009', nodePath: 'p', category: 'design', status: 'adopted' }], summary: 'draft' };
    const env = {
      output: { summary: { answer: 'refined', findings: refinedFindings } },
      raw: { implementer: '```json\n' + JSON.stringify(draft) + '\n```' },
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

