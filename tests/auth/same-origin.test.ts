// @vitest-environment node
import { rejectCrossOrigin } from '@/auth/same-origin';
import { NextRequest } from 'next/server';

function mk(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/x', { method: 'POST', headers });
}

describe('rejectCrossOrigin', () => {
  it('allows Sec-Fetch-Site: same-origin', () => {
    expect(rejectCrossOrigin(mk({ 'sec-fetch-site': 'same-origin' }))).toBeNull();
  });
  it('allows Sec-Fetch-Site: none (direct navigation)', () => {
    expect(rejectCrossOrigin(mk({ 'sec-fetch-site': 'none' }))).toBeNull();
  });
  it('rejects Sec-Fetch-Site: cross-site with 403', () => {
    const r = rejectCrossOrigin(mk({ 'sec-fetch-site': 'cross-site' }));
    expect(r?.status).toBe(403);
  });
  it('rejects Sec-Fetch-Site: same-site (different subdomain) with 403', () => {
    expect(rejectCrossOrigin(mk({ 'sec-fetch-site': 'same-site' }))?.status).toBe(403);
  });
  it('falls back to Origin/Host: matching host allowed', () => {
    expect(rejectCrossOrigin(mk({ origin: 'http://localhost', host: 'localhost' }))).toBeNull();
  });
  it('falls back to Origin/Host: mismatched host rejected', () => {
    expect(rejectCrossOrigin(mk({ origin: 'http://evil.com', host: 'localhost' }))?.status).toBe(403);
  });
  it('allows a request with no Origin and no Sec-Fetch-Site (same-origin non-CORS)', () => {
    expect(rejectCrossOrigin(mk({}))).toBeNull();
  });
});
