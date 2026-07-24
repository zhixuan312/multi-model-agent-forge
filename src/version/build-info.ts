import pkg from '../../package.json';

export interface ForgeBuildInfo {
  version: string;
  gitSha: string;
  builtAt: string;
}

function readRequiredBuildValue(name: 'FORGE_BUILD_GIT_SHA' | 'FORGE_BUILD_BUILT_AT'): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : 'unknown';
}

export function readBuildInfo(): ForgeBuildInfo {
  const packageVersion = (pkg as { version?: string }).version;

  return {
    version: typeof packageVersion === 'string' && packageVersion.length > 0 ? packageVersion : '0.0.0',
    gitSha: readRequiredBuildValue('FORGE_BUILD_GIT_SHA'),
    builtAt: readRequiredBuildValue('FORGE_BUILD_BUILT_AT'),
  };
}
