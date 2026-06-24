import { summarizeEnvelope } from '@/loops/run-deps';

describe('summarizeEnvelope', () => {
  it('unwraps a worker JSON report (findings/summary/verdict) into clean key changes + files', () => {
    const report = JSON.stringify({
      findings: [
        { severity: 'medium', category: 'correctness', description: 'Claims route test asserted a non-existent array.', location: 'tests/claims.test.ts:180', fix: 'applied' },
        { severity: 'low', category: 'verification', description: 'No worker verification evidence provided.', location: 'tests/claims.test.ts', fix: 'applied' },
      ],
      summary: 'Corrected the claims DOWNLOAD JSON expectation; TypeScript builds cleanly.',
      verdict: 'changes_made',
    });
    const env = {
      output: { summary: report, filesChanged: ['a.ts', 'b.ts', 'c.ts'] },
    };

    const out = summarizeEnvelope(env);

    // The prose summary — not the raw JSON — is the headline change.
    expect(out.keyChanges[0]).toBe('Corrected the claims DOWNLOAD JSON expectation; TypeScript builds cleanly.');
    // Files live in their own slot, never as a "change" line.
    expect(out.filesChanged).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(out.keyChanges.some((c) => /file\(s\) changed/.test(c))).toBe(false);
    // No raw JSON leaks into any change line.
    expect(out.keyChanges.some((c) => c.includes('"findings"'))).toBe(false);
    // Findings become readable, point-form change lines.
    expect(out.keyChanges.some((c) => c.includes('non-existent array') && c.includes('correctness'))).toBe(true);
  });

  it('unwraps a ```json-fenced report (the shape a real run produced)', () => {
    const fenced = '```json\n' + JSON.stringify({
      findings: [{ severity: 'high', category: 'correctness', description: 'mock wired wrong', location: 'a.test.ts' }],
      summary: 'Fixed the test harness mock wiring.',
      verdict: 'changes_made',
    }) + '\n```';
    const out = summarizeEnvelope({ output: { summary: fenced, filesChanged: ['a.test.ts'] } });
    expect(out.keyChanges[0]).toBe('Fixed the test harness mock wiring.');
    expect(out.keyChanges.some((c) => c.includes('```') || c.includes('"findings"'))).toBe(false);
  });

  it('uses plain prose summary directly when the worker did not emit JSON', () => {
    const env = { output: { summary: 'Removed three dead branches.', filesChanged: ['x.ts'] } };
    const out = summarizeEnvelope(env);
    expect(out.keyChanges[0]).toBe('Removed three dead branches.');
    expect(out.filesChanged).toEqual(['x.ts']);
  });

  it('falls back gracefully when output is absent', () => {
    const out = summarizeEnvelope({});
    expect(out.keyChanges).toEqual(['maintenance run complete']);
    expect(out.filesChanged).toEqual([]);
  });
});
