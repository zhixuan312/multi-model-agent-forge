import { compareMmaVersion, MATCHED_MMA_VERSION } from '@/mma/matched-version';
import pkg from '../../package.json';

describe('MATCHED_MMA_VERSION', () => {
  it('is sourced from package.json#matchedMmaVersion (single source of truth)', () => {
    expect(MATCHED_MMA_VERSION).toBe((pkg as { matchedMmaVersion?: string }).matchedMmaVersion);
    expect(MATCHED_MMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('compareMmaVersion', () => {
  const M = MATCHED_MMA_VERSION; // e.g. 5.12.0

  it('reports matched when the live engine equals the matched version', () => {
    const r = compareMmaVersion(M);
    expect(r.status).toBe('matched');
    expect(r.live).toBe(M);
    expect(r.matched).toBe(M);
  });

  it('reports engine-ahead when the engine has moved past the matched version', () => {
    const [maj, min] = M.split('.').map(Number);
    expect(compareMmaVersion(`${maj}.${min + 1}.0`).status).toBe('engine-ahead');
    expect(compareMmaVersion(`${maj + 1}.0.0`).status).toBe('engine-ahead');
  });

  it('reports engine-behind when the engine is older than matched', () => {
    const [maj, min] = M.split('.').map(Number);
    const older = min > 0 ? `${maj}.${min - 1}.0` : `${maj - 1}.0.0`;
    expect(compareMmaVersion(older).status).toBe('engine-behind');
  });

  it('reports unknown when the engine is unreachable (null)', () => {
    const r = compareMmaVersion(null);
    expect(r.status).toBe('unknown');
    expect(r.live).toBeNull();
  });

  it('reports unknown for an unparseable version string', () => {
    expect(compareMmaVersion('not-a-version').status).toBe('unknown');
    expect(compareMmaVersion('').status).toBe('unknown');
  });

  it('tolerates a v-prefix and trailing pre-release/build metadata', () => {
    expect(compareMmaVersion(`v${M}`).status).toBe('matched');
    expect(compareMmaVersion(`${M}-rc.1`).status).toBe('matched');
    expect(compareMmaVersion(`${M}+build.7`).status).toBe('matched');
  });

  it('compares by patch level too', () => {
    const [maj, min, pat] = M.split('.').map(Number);
    expect(compareMmaVersion(`${maj}.${min}.${pat + 1}`).status).toBe('engine-ahead');
  });
});
