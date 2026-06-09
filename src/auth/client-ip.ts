/**
 * Resolve the real client IP for the per-IP rate-limit counter (Spec 1 F18).
 *
 * In production Forge runs behind nginx, so the raw socket address is nginx's
 * IP — keying on it would collapse the whole team into one counter. When
 * `FORGE_TRUST_PROXY` is on, take the LEFT-MOST entry of `X-Forwarded-For`
 * (set by the trusted proxy). When off (local dev, no proxy), fall back to the
 * provided socket address.
 */
export function trustProxy(): boolean {
  const explicit = process.env.FORGE_TRUST_PROXY;
  if (explicit !== undefined && explicit.trim() !== '') {
    const v = explicit.trim().toLowerCase();
    return v === 'true' || v === '1';
  }
  return process.env.NODE_ENV === 'production';
}

export function resolveClientIp(opts: {
  forwardedFor?: string | null;
  socketAddr?: string | null;
}): string {
  if (trustProxy() && opts.forwardedFor) {
    const left = opts.forwardedFor.split(',')[0]?.trim();
    if (left) return left;
  }
  return opts.socketAddr?.trim() || 'unknown';
}
