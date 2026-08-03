// @vitest-environment node
import { probeGit, probeOpenai } from '@/config/connections-probe';

const reply = (status: number): typeof fetch =>
  (async () => new Response(status === 200 ? '{}' : '{"error":"x"}', { status })) as unknown as typeof fetch;
const boom: typeof fetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

describe('probeGit', () => {
  it('200 from the git host → ok', async () => {
    const r = await probeGit('ghp_x', { fetchImpl: reply(200) });
    expect(r.ok).toBe(true);
  });
  /**
   * The detail text is the whole point of a Validate button, and nothing pinned it: every
   * non-2xx read "Git host returned HTTP N.", so a bad token and a wrong endpoint were
   * reported identically when they need completely different fixes.
   */
  it('401 → not ok, and says the credential was rejected', async () => {
    const r = await probeGit('bad', { fetchImpl: reply(401) });
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('The git host rejected this credential (HTTP 401).');
  });

  it('403 points at scopes, not at the credential', async () => {
    const r = await probeGit('ghp_x', { fetchImpl: reply(403) });
    expect(r.detail).toMatch(/scopes/);
    expect(r.detail).not.toMatch(/rejected this credential/);
  });

  it("a 5xx is the host’s problem, not the token’s", async () => {
    const r = await probeGit('ghp_x', { fetchImpl: reply(503) });
    expect(r.detail).toBe('The git host is having problems (HTTP 503).');
  });
  it('empty token → not ok, no call', async () => {
    const fetchImpl = vi.fn();
    const r = await probeGit('', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('network error → not ok', async () => {
    const r = await probeGit('ghp_x', { fetchImpl: boom });
    expect(r.ok).toBe(false);
  });
});

describe('probeOpenai', () => {
  it('200 from /models → ok', async () => {
    const r = await probeOpenai('sk-x', { fetchImpl: reply(200) });
    expect(r.ok).toBe(true);
  });
  it('401 → not ok, and says the key was rejected', async () => {
    const r = await probeOpenai('bad', { fetchImpl: reply(401) });
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('The provider rejected this credential (HTTP 401).');
  });

  it('always probes OpenAI — there is no configurable base to get wrong', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await probeOpenai('sk-x', { fetchImpl });
    expect(seen).toEqual(['https://api.openai.com/v1/models']);
  });
  it('empty key → not ok, no call', async () => {
    const fetchImpl = vi.fn();
    const r = await probeOpenai('', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
