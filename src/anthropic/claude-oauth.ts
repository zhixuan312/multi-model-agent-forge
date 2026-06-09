import { execFileSync } from 'node:child_process';

/**
 * Reads the **Claude Code subscription OAuth** token from the local credential
 * store, so the orchestrator (`main` tier) can authenticate against Anthropic
 * using the same "server Claude Code auth" MMA's worker tiers use — no per-team
 * API key required. Mirrors MMA's `packages/core/src/identity/claude-oauth.ts`.
 *
 * macOS stores the token in the Keychain under service `"Claude Code-credentials"`
 * as JSON: `{"claudeAiOauth":{"accessToken","refreshToken","expiresAt",...}}`.
 *
 * Returns null when: not on macOS, the entry is absent (user never logged into
 * Claude Code / no Max subscription), the value isn't valid JSON, the access
 * token is missing, or the token has expired (refresh is not implemented —
 * subscription tokens are long-lived, and the caller falls back to a config key).
 * The token is never logged.
 */
export interface ClaudeOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
}

export function getClaudeOAuth(): ClaudeOAuthCredentials | null {
  if (process.platform !== 'darwin') return null;
  let raw: string;
  try {
    raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const oauth = (parsed as { claudeAiOauth?: Record<string, unknown> }).claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return null;

  const accessToken = typeof oauth['accessToken'] === 'string' ? oauth['accessToken'] : undefined;
  if (!accessToken) return null;

  const expiresAt = typeof oauth['expiresAt'] === 'number' ? oauth['expiresAt'] : undefined;
  if (expiresAt !== undefined && expiresAt < Date.now()) return null;

  return {
    accessToken,
    ...(typeof oauth['refreshToken'] === 'string' && { refreshToken: oauth['refreshToken'] }),
    ...(expiresAt !== undefined && { expiresAt }),
    ...(Array.isArray(oauth['scopes']) && { scopes: oauth['scopes'] as string[] }),
    ...(typeof oauth['subscriptionType'] === 'string' && { subscriptionType: oauth['subscriptionType'] }),
  };
}

/**
 * The Claude Code subscription token only authorizes `/v1/messages` when the
 * request carries this beta header AND the first system block is the exact
 * Claude Code identity string below (verified empirically — any other shape is
 * rejected). These are injected only in OAuth mode, never for a real API key.
 */
export const CLAUDE_CODE_OAUTH_BETA = 'oauth-2025-04-20';
export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
