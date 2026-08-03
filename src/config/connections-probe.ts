/**
 * Live connection probes for the Connections "Validate" buttons. Each does a
 * cheap authenticated GET and reports ok/detail — never throws. Used server-side
 * by `/api/connections/validate` (the token is decrypted there, never sent to the
 * browser). MMA is validated separately via the existing health/status client.
 */
const GITHUB_USER_URL = 'https://api.github.com/user';
/**
 * OpenAI, not a configurable base. `probeOpenai` took a `baseUrl` argument, and every caller
 * in the codebase — the route and all three tests — passed `null`. Nothing stores a base URL
 * for this connection either: `transcribe/openai.ts` hardcodes the transcription endpoint. It
 * was configurability with no way to configure it, and the tests exercising the parameter
 * were the only thing keeping it alive.
 */
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/**
 * What a non-2xx means to someone who just pressed "Validate". The status ALONE was being
 * shown ("Provider returned HTTP 401."), which is accurate and tells them nothing about what
 * to do: a rejected credential and an unreachable endpoint need completely different fixes.
 * The status is kept on the end, because it is what you quote in a bug report.
 */
function statusDetail(status: number, subject: string): string {
  if (status === 401) return `The ${subject} rejected this credential (HTTP 401).`;
  if (status === 403) return `The ${subject} accepted the credential but refused the request — check its scopes (HTTP 403).`;
  if (status === 404) return `No such endpoint at the ${subject} (HTTP 404).`;
  if (status === 429) return `The ${subject} is rate-limiting — try again shortly (HTTP 429).`;
  if (status >= 500) return `The ${subject} is having problems (HTTP ${status}).`;
  return `The ${subject} returned HTTP ${status}.`;
}

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

/**
 * Validate a git token against the GitHub API.
 *
 * GitHub is the only host, not a default — the URL is a module constant and nothing
 * selects another. "by default" implied a configurability that does not exist.
 */
export async function probeGit(token: string, opts: ProbeOpts = {}): Promise<ProbeResult> {
  if (!token.trim()) return { ok: false, detail: 'No git token to check.' };
  try {
    const res = await timedGet(GITHUB_USER_URL, { authorization: `Bearer ${token}`, 'user-agent': 'forge' }, opts);
    return res.ok
      ? { ok: true, detail: 'Token accepted by the git host.' }
      : { ok: false, detail: statusDetail(res.status, 'git host') };
  } catch (err) {
    const e = err as Error;
    return { ok: false, detail: e?.name === 'AbortError' ? 'Timed out reaching the git host.' : 'Could not reach the git host.' };
  }
}

/** Validate the OpenAI key by listing models. */
export async function probeOpenai(token: string, opts: ProbeOpts = {}): Promise<ProbeResult> {
  if (!token.trim()) return { ok: false, detail: 'No key to check.' };
  try {
    const res = await timedGet(OPENAI_MODELS_URL, { authorization: `Bearer ${token}` }, opts);
    return res.ok
      ? { ok: true, detail: 'Key accepted by the provider.' }
      : { ok: false, detail: statusDetail(res.status, 'provider') };
  } catch (err) {
    const e = err as Error;
    return { ok: false, detail: e?.name === 'AbortError' ? 'Timed out reaching the provider.' : 'Could not reach the provider.' };
  }
}
