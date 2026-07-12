// @vitest-environment node
import { mintEventToken, hashEventToken, verifyEventToken } from '@/loops/event-token';

describe('event-token helpers', () => {
  it('mints opaque high-entropy tokens and stores only a sha256 hash', () => {
    const token = mintEventToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    const hash = hashEventToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(token);
  });

  it('verifies the correct token and rejects a wrong one', () => {
    const token = mintEventToken();
    const hash = hashEventToken(token);
    expect(verifyEventToken(token, hash)).toBe(true);
    expect(verifyEventToken('wrong-token', hash)).toBe(false);
  });

  it('rejects blank token candidates and blank stored hashes', () => {
    expect(verifyEventToken('', hashEventToken('abc'))).toBe(false);
    expect(verifyEventToken('abc', '')).toBe(false);
  });
});
