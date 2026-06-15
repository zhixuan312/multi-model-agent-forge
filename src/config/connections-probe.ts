/**
 * Live connection probes for the Connections "Validate" buttons. Each does a
 * cheap authenticated GET and reports ok/detail — never throws. Used server-side
 * by `/api/connections/validate` (the token is decrypted there, never sent to the
 * browser). MMA is validated separately via the existing health/status client.
 */
const GITHUB_USER_URL = 'https://api.github.com/user';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

export interface ProbeOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function timedGet(url: string, headers: Record<string, string>, opts: ProbeOpts): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    return await fetchImpl(url, { method: 'GET', headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Validate a git service token against the host API (GitHub by default). */
export async function probeGit(token: string, opts: ProbeOpts = {}): Promise<ProbeResult> {
  if (!token.trim()) return { ok: false, detail: 'No git token to check.' };
  try {
    const res = await timedGet(GITHUB_USER_URL, { authorization: `Bearer ${token}`, 'user-agent': 'forge' }, opts);
    return res.ok
      ? { ok: true, detail: 'Token accepted by the git host.' }
      : { ok: false, detail: `Git host returned HTTP ${res.status}.` };
  } catch (err) {
    const e = err as Error;
    return { ok: false, detail: e?.name === 'AbortError' ? 'Timed out reaching the git host.' : 'Could not reach the git host.' };
  }
}

/** Validate an OpenAI(-compatible) key by listing models at the endpoint. */
export async function probeOpenai(token: string, baseUrl: string | null, opts: ProbeOpts = {}): Promise<ProbeResult> {
  if (!token.trim()) return { ok: false, detail: 'No key to check.' };
  const url = `${(baseUrl ?? DEFAULT_OPENAI_BASE).replace(/\/+$/, '')}/models`;
  try {
    const res = await timedGet(url, { authorization: `Bearer ${token}` }, opts);
    return res.ok
      ? { ok: true, detail: 'Key accepted by the provider.' }
      : { ok: false, detail: `Provider returned HTTP ${res.status}.` };
  } catch (err) {
    const e = err as Error;
    return { ok: false, detail: e?.name === 'AbortError' ? 'Timed out reaching the provider.' : 'Could not reach the provider.' };
  }
}
