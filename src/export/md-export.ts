/**
 * Single-artifact `.md` export (Spec 8 §In-scope #6, F19). Chromium-independent —
 * always works even if the PDF engine is broken.
 *
 * Faithful (no transformation): every export kind has a stored `body_md`, so the
 * bytes written are the bytes stored.
 */
import { mdFileName } from '@/export/slug';
import type { ExportKind } from '@/export/types';

export interface MdExport {
  fileName: string;
  /** The faithful markdown body (UTF-8). */
  body: string;
  /** The body as a Buffer (for streaming / zip). */
  buffer: Buffer;
}

/** Build the `.md` export for an artifact body of a given kind. */
export function buildMdExport(kind: ExportKind, bodyMd: string): MdExport {
  return {
    fileName: mdFileName(kind),
    body: bodyMd,
    buffer: Buffer.from(bodyMd, 'utf-8'),
  };
}
