/**
 * Zip pipeline (Spec 8 §"Zip pipeline (Export everything)", F2/F18). Streams a
 * `.zip` of every ready artifact's `.md` (fixed kind-noun names) + one combined
 * PDF (`<project-slug>.pdf`) via `archiver` — NEVER buffering the whole archive.
 *
 * The route pipes the returned Node stream into the response body (no
 * `Content-Length` → chunked). The combined PDF is the only fully-buffered piece
 * (it has no streaming API, F18) — an accepted, cap-bounded cost.
 */
import { ZipArchive } from 'archiver';
import { PassThrough, type Readable } from 'node:stream';
import { mdFileName, slug } from '@/export/slug';
import type { ExportKind } from '@/export/types';

export interface ZipEntryMd {
  kind: ExportKind;
  body: string;
}

export interface BuildZipInput {
  /** Ready artifacts' markdown (fixed kind-noun filenames). */
  md: ZipEntryMd[];
  /** The combined PDF buffer (named `<project-slug>.pdf`). */
  combinedPdf: Buffer;
  /** Project name → slug for the combined PDF filename. */
  projectName: string;
}

export interface ZipResult {
  /** The Node Readable to pipe into the route response (streamed, not buffered). */
  stream: Readable;
  /** The .zip filename (`<project-slug>.zip`). */
  fileName: string;
  /** Resolves when the archive has fully flushed (for on-disk persistence). */
  done: Promise<void>;
}

/**
 * Build a streamed `.zip`. Returns the stream immediately; archiver pumps into
 * it as entries append. The PDF filename is `<project-slug>.pdf`.
 */
export function buildBundleZip(input: BuildZipInput): ZipResult {
  const projectSlug = slug(input.projectName);
  const pdfName = `${projectSlug}.pdf`;
  const zipName = `${projectSlug}.zip`;

  const out = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise<void>((resolve, reject) => {
    out.on('end', () => resolve());
    out.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
  });
  archive.pipe(out);

  for (const m of input.md) {
    archive.append(Buffer.from(m.body, 'utf-8'), { name: mdFileName(m.kind) });
  }
  archive.append(input.combinedPdf, { name: pdfName });

  void archive.finalize();

  // No `entryNames` here. It used to be returned and threaded all the way up through
  // `BundleResult`, where nothing read it — the route's `x-bundle-included` header is
  // built from the artifact KINDS. It only ever fed tests, and as a list assembled
  // beside the appends rather than read back from them, it would have kept reporting
  // an entry that failed to append. The tests read the archive instead.
  return { stream: out, fileName: zipName, done };
}

/** Collect a Readable into a Buffer (for on-disk persistence / tests). */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
