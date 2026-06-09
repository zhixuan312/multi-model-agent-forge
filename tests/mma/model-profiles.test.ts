// @vitest-environment node
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flattenProfiles, readModelProfiles, type ProfileGroup } from '@/mma/model-profiles';

const SAMPLE: ProfileGroup[] = [
  {
    provider: 'anthropic',
    naming: 'claude-{tier}-{major}-{minor}',
    defaults: { family: 'claude', supportsEffort: true },
    profiles: [
      { prefix: 'claude', tier: 'standard', bestFor: 'general Claude tasks' },
      { prefix: 'claude-opus', tier: 'reasoning', bestFor: 'high-ambiguity tasks' },
      { prefix: 'claude-sonnet', bestFor: 'professional coding' }, // no tier
    ],
  },
  {
    provider: 'openai',
    profiles: [{ prefix: 'gpt-5' }], // no tier, no bestFor
  },
];

describe('flattenProfiles', () => {
  it('flattens groups → { provider, prefix, tier, bestFor } with verbatim prefix', () => {
    const flat = flattenProfiles(SAMPLE);
    expect(flat).toEqual([
      { provider: 'anthropic', prefix: 'claude', tier: 'standard', bestFor: 'general Claude tasks' },
      { provider: 'anthropic', prefix: 'claude-opus', tier: 'reasoning', bestFor: 'high-ambiguity tasks' },
      { provider: 'anthropic', prefix: 'claude-sonnet', tier: null, bestFor: 'professional coding' },
      { provider: 'openai', prefix: 'gpt-5', tier: null, bestFor: null },
    ]);
  });

  it('has NO family field and defaults tier/bestFor to null when the source omits them', () => {
    const flat = flattenProfiles(SAMPLE);
    const gpt = flat.find((f) => f.prefix === 'gpt-5')!;
    expect(gpt.tier).toBeNull();
    expect(gpt.bestFor).toBeNull();
    expect('family' in gpt).toBe(false);
  });

  it('handles a group with only defaults + minimal profiles', () => {
    const flat = flattenProfiles([{ provider: 'x', defaults: { family: 'x' }, profiles: [{ prefix: 'x-1' }] }]);
    expect(flat).toEqual([{ provider: 'x', prefix: 'x-1', tier: null, bestFor: null }]);
  });
});

describe('readModelProfiles', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mp-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads + flattens the catalog from a resolved install path', () => {
    const distDir = join(dir, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'model-profiles.json'), JSON.stringify(SAMPLE), 'utf8');
    const result = readModelProfiles({ explicitPath: join(distDir, 'model-profiles.json') });
    expect(result.available).toBe(true);
    expect(result.profiles.length).toBe(4);
    expect(result.profiles[0].prefix).toBe('claude');
  });

  it('gracefully returns an empty list when the file is not found', () => {
    const result = readModelProfiles({ explicitPath: join(dir, 'nope.json'), candidatePaths: [] });
    expect(result.available).toBe(false);
    expect(result.profiles).toEqual([]);
  });

  it('gracefully returns an empty list on malformed JSON', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not valid', 'utf8');
    const result = readModelProfiles({ explicitPath: p, candidatePaths: [] });
    expect(result.available).toBe(false);
    expect(result.profiles).toEqual([]);
  });
});
