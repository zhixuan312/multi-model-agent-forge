import { fileURLToPath } from 'node:url';

/** Absolute path to the fixture workspace root that contains `.mma/journal/`. */
export const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures', import.meta.url));
