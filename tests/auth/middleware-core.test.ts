// @vitest-environment node
import { evaluateRequest } from '@/auth/middleware-core';

describe('evaluateRequest (stateless cookie-presence pre-check, no DB)', () => {
  it('lets /login through without a cookie (only unauthenticated route)', () => {
    expect(evaluateRequest({ pathname: '/login', hasSessionCookie: false })).toEqual({ action: 'next' });
  });

  it('redirects an (app) route to /login when the cookie is absent', () => {
    expect(evaluateRequest({ pathname: '/projects', hasSessionCookie: false })).toEqual({
      action: 'redirect',
      to: '/login',
    });
    expect(evaluateRequest({ pathname: '/settings', hasSessionCookie: false })).toEqual({
      action: 'redirect',
      to: '/login',
    });
  });

  it('401s an /api route when the cookie is absent', () => {
    expect(evaluateRequest({ pathname: '/api/members', hasSessionCookie: false })).toEqual({
      action: 'unauthorized',
    });
    expect(evaluateRequest({ pathname: '/api/auth/password', hasSessionCookie: false })).toEqual({
      action: 'unauthorized',
    });
  });

  it('lets the login API action through unauthenticated', () => {
    expect(evaluateRequest({ pathname: '/api/auth/login', hasSessionCookie: false })).toEqual({
      action: 'next',
    });
  });

  it('lets any route through when a session cookie is present (presence only — no validation)', () => {
    expect(evaluateRequest({ pathname: '/projects', hasSessionCookie: true })).toEqual({ action: 'next' });
    expect(evaluateRequest({ pathname: '/settings', hasSessionCookie: true })).toEqual({ action: 'next' });
    expect(evaluateRequest({ pathname: '/api/members', hasSessionCookie: true })).toEqual({ action: 'next' });
  });

  it('lets Next internals + favicon through', () => {
    expect(evaluateRequest({ pathname: '/_next/static/chunk.js', hasSessionCookie: false })).toEqual({
      action: 'next',
    });
    expect(evaluateRequest({ pathname: '/favicon.ico', hasSessionCookie: false })).toEqual({ action: 'next' });
  });
});
