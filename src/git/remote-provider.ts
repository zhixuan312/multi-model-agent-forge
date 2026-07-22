/**
 * Git hosting-provider detection for loop automation (push + open a PR/MR).
 *
 * Loops need two provider-specific things: an authenticated HTTPS push URL, and an API
 * call to open a change request. GitHub and GitLab are both supported, including
 * self-managed / dedicated GitLab hosts (e.g. `sgts.gitlab-dedicated.com`), detected by
 * a `gitlab` marker in the hostname. Everything else parses to `null` (unsupported).
 *
 * Pure and dependency-free so it is unit-tested directly; the IO (git push, fetch) lives
 * in the loop run-deps adapter.
 */

export type RemoteInfo =
  | { provider: 'github'; host: string; owner: string; repo: string }
  /** GitLab projects can be deeply nested (group/subgroup/project), so they carry a full
   *  slash-joined `projectPath` rather than owner/repo — url-encoded for the v4 API. */
  | { provider: 'gitlab'; host: string; projectPath: string };

/** Parse a git remote URL (ssh or https, with or without an embedded credential) into a
 *  known provider + coordinates, or `null` when the host isn't a supported provider. */
export function parseRemote(url: string): RemoteInfo | null {
  const s = url.trim();

  // GitHub: github.com[:/]owner/repo(.git) — owner/repo is always exactly two segments.
  const gh = s.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  if (gh) return { provider: 'github', host: 'github.com', owner: gh[1], repo: gh[2] };

  // GitLab (gitlab.com OR a self-managed/dedicated host whose name contains "gitlab"):
  //   https://[cred@]<host>/<group>/…/<project>(.git)   |   git@<host>:<group>/…/<project>(.git)
  // The leading `[^@/]*@` swallows an embedded credential (e.g. `x-access-token@`).
  const gl = s.match(/^(?:https?:\/\/)?(?:[^@/]*@)?([^/:]*gitlab[^/:]*)[:/](.+?)(?:\.git)?$/i);
  if (gl) return { provider: 'gitlab', host: gl[1], projectPath: gl[2] };

  return null;
}

/** The authenticated HTTPS URL to push to, per provider (never logged). */
export function authPushUrl(info: RemoteInfo, token: string): string {
  if (info.provider === 'github') {
    return `https://x-access-token:${token}@github.com/${info.owner}/${info.repo}.git`;
  }
  // GitLab accepts `oauth2:<token>` for a personal / project / group access token over HTTPS.
  return `https://oauth2:${token}@${info.host}/${info.projectPath}.git`;
}
