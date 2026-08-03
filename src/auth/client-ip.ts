/**
 * Resolve the client IP that keys the per-IP login rate-limit counter (Spec 1 F18).
 *
 * Everything available here is a REQUEST HEADER. Next's `headers()` does not expose the
 * TCP peer address, so there is no unforgeable source — which is exactly why the
 * precedence below matters.
 *
 * `X-Real-IP` is preferred over `X-Forwarded-For` when a proxy is trusted. Both are
 * proxy-set, but only one of them is proxy-set *exclusively*: the canonical nginx recipe
 * is
 *
 *     proxy_set_header X-Real-IP        $remote_addr;                 # REPLACES
 *     proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;   # APPENDS
 *
 * `$proxy_add_x_forwarded_for` appends the peer to whatever the client already sent, so
 * the LEFT-MOST entry of `X-Forwarded-For` is a value the CLIENT chose. This function
 * used to read exactly that and describe it as "set by the trusted proxy" — so an
 * attacker could send a fresh `X-Forwarded-For` per request and get a fresh rate-limit
 * bucket every time, defeating the per-IP half of the login throttle. (The per-username
 * half still applied, so one account stayed protected; spraying a password across many
 * usernames did not.)
 *
 * OPERATOR REQUIREMENT, stated in DEPLOYMENT.md and .env.example: with
 * `FORGE_TRUST_PROXY` on, the proxy MUST set `X-Real-IP` (or overwrite `X-Forwarded-For`
 * rather than appending to it). A deployment that forwards client headers untouched has
 * no per-IP throttle, whatever this function does.
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
  /** `X-Forwarded-For`. Its left-most hop is client-supplied under the usual nginx recipe. */
  forwardedFor?: string | null;
  /** `X-Real-IP`. A single value the proxy REPLACES, so a client cannot extend it. */
  realIp?: string | null;
}): string {
  const realIp = opts.realIp?.trim();

  if (trustProxy()) {
    // The single-valued, proxy-replaced header first.
    if (realIp) return realIp;
    // Only when the proxy did not set it. Documented as the weaker path rather than
    // silently treated as equivalent.
    const left = opts.forwardedFor?.split(',')[0]?.trim();
    if (left) return left;
  }

  // No trusted proxy: nothing here is authoritative. Keep the previous best-effort
  // header rather than collapsing every dev request into one bucket — but stop calling
  // it a socket address, which the old parameter name claimed and it never was.
  return realIp || 'unknown';
}
