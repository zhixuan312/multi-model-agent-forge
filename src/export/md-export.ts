/**
 * Single-artifact `.md` export (Spec 8 §In-scope #6, F19). Chromium-independent —
 * always works even if the PDF engine is broken.
 *
 * Faithful (no transformation) for exploration / spec / plan (they have a stored
 * `body_md`). For review there is no stored body, so the markdown is the
 * adapter-normalized string (F25) — byte-faithful to THAT.
 */
import { mdFileName, type ExportArtifactKind } from '@/export/slug';

export interface MdExport {
  fileName: string;
  /** The faithful markdown body (UTF-8). */
  body: string;
  /** The body as a Buffer (for streaming / zip). */
  buffer: Buffer;
}

/** Build the `.md` export for an artifact body of a given kind. */
export function buildMdExport(kind: ExportArtifactKind, bodyMd: string): MdExport {
  return {
    fileName: mdFileName(kind),
    body: bodyMd,
    buffer: Buffer.from(bodyMd, 'utf-8'),
  };
}
