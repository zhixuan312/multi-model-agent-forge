import { deriveSummary } from '@/spec/summary';

describe('deriveSummary (deterministic, no LLM)', () => {
  it('returns a short string verbatim with NO ellipsis (≤120)', () => {
    expect(deriveSummary('A short intent.')).toBe('A short intent.');
  });

  it('collapses internal whitespace and trims', () => {
    expect(deriveSummary('  hello   world  \n  again ')).toBe('hello world again');
  });

  it('cuts a long string at the last space within head[0..120] + a single ellipsis', () => {
    const word = 'lorem';
    const long = Array.from({ length: 40 }, () => word).join(' '); // 40*6-1 = 239 chars
    const out = deriveSummary(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(121);
    // The cut is at a word boundary — no partial word before the ellipsis.
    expect(out.slice(0, -1).endsWith(' ')).toBe(false);
    expect(out.slice(0, -1).split(' ').every((w) => w === word)).toBe(true);
  });

  it('hard-cuts at exactly char 120 + ellipsis when head has no space', () => {
    const noSpace = 'x'.repeat(200);
    const out = deriveSummary(noSpace);
    expect(out).toBe('x'.repeat(120) + '…');
    expect(out.length).toBe(121);
  });

  it('boundary: exactly 120 chars is verbatim (no ellipsis)', () => {
    const s = 'a'.repeat(120);
    expect(deriveSummary(s)).toBe(s);
  });
});
