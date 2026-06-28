import { mkdir, writeFile, unlink, rm, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { attachment } from '@/db/schema/exploration';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { logAction } from '@/observability/action-log';
import { logPoll } from '@/observability/poll-log';

/**
 * Attachment upload safety + on-disk lifecycle. For image/file the storage
 * path is ALWAYS server-generated under the traversal/symlink-checked
 * workspace attachment area — never client-supplied. MIME/extension allow-list
 * rejects anything else. link payloads store only a validated {url}.
 */

export const MAX_ATTACHMENTS_PER_PROJECT = 20;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_URL_LENGTH = 2048;

export const IMAGE_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
export const FILE_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
};

/** The attachment storage root under the workspace (co-located deploy). */
export function attachmentsRoot(workspaceRoot = resolveWorkspaceRoot()): string {
  return join(workspaceRoot, '.forge-attachments');
}

function projectDir(projectId: string, workspaceRoot?: string): string {
  return join(attachmentsRoot(workspaceRoot), projectId);
}

export class AttachmentRejectError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AttachmentRejectError';
    this.status = status;
  }
}

export const linkSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .max(MAX_URL_LENGTH)
    .refine((u) => /^https?:\/\//i.test(u), 'URL must be http or https.'),
});

export interface AttachmentView {
  id: string;
  kind: 'link' | 'image' | 'file';
  label: string;
  payload: unknown;
}

export interface AttachmentDeps {
  db?: Db;
  workspaceRoot?: string;
}

async function countFor(db: Db, projectId: string): Promise<number> {
  const rows = await db.select({ id: attachment.id }).from(attachment).where(eq(attachment.projectId, projectId));
  return rows.length;
}

/** Add a link attachment (application/json {label,url}). */
export async function addLink(
  projectId: string,
  input: unknown,
  actor: { id: string },
  deps: AttachmentDeps = {},
): Promise<AttachmentView> {
  const db = deps.db ?? getDb();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) throw new AttachmentRejectError(400, 'Invalid link.');
  if ((await countFor(db, projectId)) >= MAX_ATTACHMENTS_PER_PROJECT) {
    throw new AttachmentRejectError(413, 'Attachment limit reached (20).');
  }
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(attachment)
      .values({
        projectId,
        kind: 'link',
        label: parsed.data.label,
        payload: { url: parsed.data.url },
        createdBy: actor.id,
      })
      .returning({ id: attachment.id, kind: attachment.kind, label: attachment.label, payload: attachment.payload });
    await logAction(
      { projectId, memberId: actor.id, action: 'explore_attach', target: `attachment:${r.id}`, meta: { kind: 'link' } },
      tx as unknown as Db,
    );
    return r;
  });
  return row as AttachmentView;
}

/** Resolve the allow-listed extension for a (kind, mime), or reject (415). */
function extFor(kind: 'image' | 'file', mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  const ext = (kind === 'image' ? IMAGE_MIME : FILE_MIME)[base];
  if (!ext) throw new AttachmentRejectError(415, 'Unsupported attachment type.');
  return ext;
}

/**
 * Add an image/file attachment. The path is server-generated, the write-then-
 * insert is one unit (a byte-write failure → no row, partial file unlinked, 5xx),
 * and the resolved real path is confined under the project's attachment dir.
 */
export async function addUpload(
  projectId: string,
  args: { kind: 'image' | 'file'; label: string; bytes: Uint8Array; mime: string },
  actor: { id: string },
  deps: AttachmentDeps = {},
): Promise<AttachmentView> {
  const db = deps.db ?? getDb();
  const label = args.label.trim();
  if (!label) throw new AttachmentRejectError(400, 'A label is required.');
  if (args.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRejectError(413, 'File exceeds the 25 MB limit.');
  }
  const ext = extFor(args.kind, args.mime); // 415 on a disallowed type
  if ((await countFor(db, projectId)) >= MAX_ATTACHMENTS_PER_PROJECT) {
    throw new AttachmentRejectError(413, 'Attachment limit reached (20).');
  }

  const dir = projectDir(projectId, deps.workspaceRoot);
  const fileName = `${randomUUID()}${ext}`;
  const filePath = join(dir, fileName);

  // Traversal/symlink confinement: the resolved path must stay under the dir.
  const root = resolve(dir);
  if (!resolve(filePath).startsWith(root + sep)) {
    throw new AttachmentRejectError(400, 'Invalid storage path.');
  }

  await mkdir(dir, { recursive: true });
  try {
    await writeFile(filePath, args.bytes, { flag: 'wx' });
    // Symlink check: the real path must still be under the project dir.
    const realDir = await realpath(dir);
    const real = await realpath(filePath);
    if (!real.startsWith(realDir + sep)) {
      await unlink(filePath).catch(() => {});
      throw new AttachmentRejectError(400, 'Resolved path escaped the workspace.');
    }
  } catch (err) {
    if (err instanceof AttachmentRejectError) throw err;
    await unlink(filePath).catch(() => {}); // remove any partial byte
    logPoll({ level: 'error', event: 'attachment.write_error', projectId, detail: errName(err) });
    throw new AttachmentRejectError(500, 'Failed to store the attachment.');
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(attachment)
        .values({
          projectId,
          kind: args.kind,
          label,
          payload: { path: filePath, size: args.bytes.byteLength, ext },
          createdBy: actor.id,
        })
        .returning({ id: attachment.id, kind: attachment.kind, label: attachment.label, payload: attachment.payload });
      await logAction(
        { projectId, memberId: actor.id, action: 'explore_attach', target: `attachment:${r.id}`, meta: { kind: args.kind } },
        tx as unknown as Db,
      );
      return r;
    });
    return row as AttachmentView;
  } catch (err) {
    await unlink(filePath).catch(() => {}); // row failed → don't orphan the byte
    logPoll({ level: 'error', event: 'attachment.write_error', projectId, detail: errName(err) });
    throw new AttachmentRejectError(500, 'Failed to store the attachment.');
  }
}

/** Remove an attachment: unlink the on-disk byte (if any) then delete the row. */
export async function removeAttachment(
  projectId: string,
  attachmentId: string,
  actor: { id: string },
  deps: AttachmentDeps = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .select({ payload: attachment.payload })
    .from(attachment)
    .where(and(eq(attachment.id, attachmentId), eq(attachment.projectId, projectId)))
    .limit(1);
  if (!row) throw new AttachmentRejectError(404, 'Attachment not found.');

  const p = (row.payload as { path?: unknown }).path;
  if (typeof p === 'string') {
    await unlink(p).catch((err) => {
      // A unlink failure is logged but does not block the row delete (swept-later).
      logPoll({ level: 'warn', event: 'attachment.write_error', projectId, detail: `unlink: ${errName(err)}` });
    });
  }
  await db.transaction(async (tx) => {
    await tx.delete(attachment).where(eq(attachment.id, attachmentId));
    await logAction(
      { projectId, memberId: actor.id, action: 'explore_detach', target: `attachment:${attachmentId}` },
      tx as unknown as Db,
    );
  });
}

/** On project delete, recursively remove the project's attachment dir (CASCADE
 * clears rows but cannot reach the filesystem). */
export async function purgeProjectAttachments(projectId: string, deps: AttachmentDeps = {}): Promise<void> {
  const dir = projectDir(projectId, deps.workspaceRoot);
  await rm(dir, { recursive: true, force: true }).catch((err) => {
    logPoll({ level: 'warn', event: 'attachment.write_error', projectId, detail: `rmdir: ${errName(err)}` });
  });
}

export async function listAttachments(
  projectId: string,
  deps: AttachmentDeps = {},
): Promise<AttachmentView[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({ id: attachment.id, kind: attachment.kind, label: attachment.label, payload: attachment.payload })
    .from(attachment)
    .where(eq(attachment.projectId, projectId));
  return rows as AttachmentView[];
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
