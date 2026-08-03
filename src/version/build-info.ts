import pkg from '../../package.json';

export interface ForgeBuildInfo {
  version: string;
  gitSha: string;
  builtAt: string;
}

/**
 * A build stamp, or the literal `'unknown'` when the Docker build arg was not passed.
 *
 * Named `readRequired…` but it never throws: `/api/version` is the container's liveness
 * endpoint and its HEALTHCHECK, so a missing stamp must degrade to a reportable value
 * rather than 500 the probe. The release runbook treats `'unknown'` as a FAILED gate
 * (Phase 5b), which is where the requirement is actually enforced.
 */
function readBuildValue(name: 'FORGE_BUILD_GIT_SHA' | 'FORGE_BUILD_BUILT_AT'): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : 'unknown';
}

export function readBuildInfo(): ForgeBuildInfo {
  const packageVersion = (pkg as { version?: string }).version;

  return {
    version: typeof packageVersion === 'string' && packageVersion.length > 0 ? packageVersion : '0.0.0',
    gitSha: readBuildValue('FORGE_BUILD_GIT_SHA'),
    builtAt: readBuildValue('FORGE_BUILD_BUILT_AT'),
  };
}
