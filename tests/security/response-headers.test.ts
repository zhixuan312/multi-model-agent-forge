// @vitest-environment node
/**
 * The security headers, which nothing checked.
 *
 * `next.config.ts` sets CSP, X-Frame-Options, nosniff, Referrer-Policy and
 * Permissions-Policy on every route, and no test read any of them. Headers fail silently by
 * construction — a deleted directive changes no behaviour a user or a test would notice,
 * right up until it is the thing that mattered.
 *
 * The `connect-src` case is why this file exists. It read `'self' https:`, which permits an
 * XHR to any HTTPS origin — the single directive standing between injected script and a
 * team's spec leaving the building — while the comment directly above it said "same-origin".
 * Nothing reconciled the two.
 */
import nextConfig from '../../next.config';

async function headerMap(): Promise<Map<string, string>> {
  const groups = await nextConfig.headers!();
  // One group covering every path. If that ever splits, this test must be told.
  expect(groups).toHaveLength(1);
  expect(groups[0].source).toBe('/:path*');
  return new Map(groups[0].headers.map((h) => [h.key, h.value]));
}

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((d) => {
      const [name, ...rest] = d.trim().split(/\s+/);
      return [name, rest.join(' ')];
    }),
  );
}

describe('response security headers', () => {
  it('sets every header on every path', async () => {
    const h = await headerMap();
    expect([...h.keys()].sort()).toEqual([
      'Content-Security-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]);
  });

  /**
   * The exfiltration boundary. `'self'` and nothing else: every outbound call Forge makes
   * (the MMA engine, api.github.com) is made from Node, so the browser has no legitimate
   * cross-origin destination.
   */
  it('confines browser connections to the same origin', async () => {
    const csp = directives((await headerMap()).get('Content-Security-Policy')!);
    expect(csp.get('connect-src')).toBe("'self'");
  });

  it('defaults to self and refuses foreign framing', async () => {
    const h = await headerMap();
    const csp = directives(h.get('Content-Security-Policy')!);
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('frame-ancestors')).toBe("'self'");
    expect(h.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  /**
   * No remote script origin. The two unsafe tokens are load-bearing — Next's hydration
   * emits inline scripts, and mermaid/three eval — but a THIRD-PARTY host would mean an
   * attacker-controlled origin could serve executable code.
   */
  it('allows no foreign script origin', async () => {
    const csp = directives((await headerMap()).get('Content-Security-Policy')!);
    const sources = csp.get('script-src')!.split(/\s+/);
    expect(sources.filter((s) => s.includes('//'))).toEqual([]);
    expect(sources).toContain("'self'");
  });

  /** Voice transcription needs the mic; nothing needs the camera or location. */
  it('grants only the microphone, and only to this origin', async () => {
    const pp = (await headerMap()).get('Permissions-Policy')!;
    expect(pp).toContain('microphone=(self)');
    expect(pp).toContain('camera=()');
    expect(pp).toContain('geolocation=()');
  });

  it('keeps nosniff and a referrer policy that does not leak paths cross-origin', async () => {
    const h = await headerMap();
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
    expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});
