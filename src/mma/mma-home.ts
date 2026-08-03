import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The directory that holds MMA's `.mma/` — its auth token and its `config.json`.
 *
 * `MMA_HOME` when set, else the process's home directory. That is what the Dockerfile
 * means by it (`ENV MMA_HOME=/home/node`) and what `.env.example` documents
 * (`<MMA_HOME|$HOME>/.mma/auth-token`, `<MMA_HOME|$HOME>/.mma/config.json`).
 *
 * It exists because the two readers of that one directory disagreed. `client-config.ts`
 * resolved the bearer through `MMA_HOME || homedir()`; `mma-config-reader.ts` resolved
 * `config.json` through `homedir()` alone. They coincide only while MMA_HOME equals $HOME
 * — which is exactly the case where the variable is doing nothing. Point it at a mounted
 * volume, the reason it exists, and Forge finds the bearer and not the config: every tier
 * reads as unconfigured on the Models page, and `buildMmaClient` sends
 * `DEFAULT_MAIN_MODEL` instead of the model the operator set. Nothing fails; it is just
 * quietly the wrong model.
 */
export function mmaHomeDir(): string {
  return process.env.MMA_HOME?.trim() || homedir();
}

/** A path inside MMA's `.mma/` directory. */
export function mmaHomePath(...segments: string[]): string {
  return join(mmaHomeDir(), '.mma', ...segments);
}
