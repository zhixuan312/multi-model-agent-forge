// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { currentJournalLogCount, isPinStale } from '@/journal/journal-rev';

// tests/journal/fixtures has a real .mma/journal/log.md with 7 entries.
const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('journal-rev', () => {
  it('counts the log.md entries at the workspace root', async () => {
    expect(await currentJournalLogCount(FIXTURE_ROOT)).toBe(7);
  });

  it('returns 0 when there is no journal yet (missing log)', async () => {
    expect(await currentJournalLogCount('/tmp/forge-no-such-journal-xyz')).toBe(0);
  });

  it('isPinStale: below current → stale; equal/above → fresh', () => {
    expect(isPinStale(5, 7)).toBe(true);
    expect(isPinStale(7, 7)).toBe(false);
    expect(isPinStale(8, 7)).toBe(false); // defensive: never "stale" if somehow ahead
  });
});
