/**
 * The upload limit and the two messages that describe failing it.
 *
 * These lived in `create-project-subset.ts`, which imports `node:crypto` — so the browser
 * could not read the limit it was about to exceed. The picker therefore accepted any size,
 * base64-encoded the whole file in the tab (a 40 MB PDF is ~53 MB of string, built
 * synchronously), submitted it, and only then learned the server's answer. The user waited
 * through the freeze and the round-trip to be told the file was too big all along.
 *
 * A leaf module with no imports is readable from both sides, so the guard can run before the
 * encode and still be the SAME limit the server enforces — one number, checked twice, rather
 * than a client copy that drifts from the real rule.
 */

/** Hard cap on an uploaded exploration/spec, enforced server-side in `decodeUploadedArtifact`. */
export const MAX_UPLOAD_BYTES = 300_000;

/**
 * Too big and not-text are different problems with different fixes, and they used to share
 * one message: "file failed to load or parse — re-upload". Re-uploading a 4 MB file produces
 * the identical failure, so that instruction cannot work for the one case where the user
 * could act — they need to know the limit.
 */
export const CREATE_PROJECT_FILE_TOO_LARGE =
  `that file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1000)} KB — upload a smaller one`;

export const CREATE_PROJECT_FILE_ERROR = 'file failed to load or parse — re-upload';
