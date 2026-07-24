// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readBuildInfo = vi.fn();
vi.mock('@/version/build-info', () => ({ readBuildInfo }));

const { GET } = await import('../../app/api/version/route');

describe('GET /api/version', () => {
  beforeEach(() => {
    readBuildInfo.mockReset();
  });

  it('returns the build-injected forge version payload verbatim', async () => {
    readBuildInfo.mockReturnValue({
      version: '0.1.0',
      gitSha: 'abc123def456',
      builtAt: '2026-07-24T09:30:00.000Z',
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: '0.1.0',
      gitSha: 'abc123def456',
      builtAt: '2026-07-24T09:30:00.000Z',
    });
    expect(readBuildInfo).toHaveBeenCalledTimes(1);
  });
});
