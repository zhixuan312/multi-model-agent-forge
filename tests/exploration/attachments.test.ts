// @vitest-environment node
import { afterEach, beforeEach } from 'vitest';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { attachment } from '@/db/schema/exploration';
import {
  addLink,
  addUpload,
  removeAttachment,
  purgeProjectAttachments,
  AttachmentRejectError,
  attachmentsRoot,
  MAX_ATTACHMENT_BYTES,
} from '@/exploration/attachments';
import { seedProject, cleanupExploreFixtures } from './db-fixtures';

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'forge-attach-'));
});
afterEach(async () => {
  await cleanupExploreFixtures();
});

describe('attachments', () => {
  it('stores a link as {url} (json) with no disk write', async () => {
    const { projectId, ownerId } = await seedProject();
    const v = await addLink(projectId, { label: 'Docs', url: 'https://example.com/x' }, { id: ownerId }, { workspaceRoot });
    expect(v).toMatchObject({ kind: 'link', label: 'Docs' });
    expect((v.payload as { url: string }).url).toBe('https://example.com/x');
  });

  it('rejects a non-http link (415/400 before insert)', async () => {
    const { projectId, ownerId } = await seedProject();
    await expect(
      addLink(projectId, { label: 'x', url: 'ftp://nope' }, { id: ownerId }, { workspaceRoot }),
    ).rejects.toThrow(AttachmentRejectError);
    const rows = await getDb().select().from(attachment).where(eq(attachment.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a disallowed MIME (415) before any disk write', async () => {
    const { projectId, ownerId } = await seedProject();
    await expect(
      addUpload(
        projectId,
        { kind: 'image', label: 'x', bytes: new Uint8Array([1, 2, 3]), mime: 'image/svg+xml' },
        { id: ownerId },
        { workspaceRoot },
      ),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('rejects an oversized upload (413)', async () => {
    const { projectId, ownerId } = await seedProject();
    await expect(
      addUpload(
        projectId,
        { kind: 'file', label: 'big', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1), mime: 'application/pdf' },
        { id: ownerId },
        { workspaceRoot },
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('stores a valid image with a SERVER-generated path under the project dir', async () => {
    const { projectId, ownerId } = await seedProject();
    const v = await addUpload(
      projectId,
      { kind: 'image', label: 'shot', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      { id: ownerId },
      { workspaceRoot },
    );
    const path = (v.payload as { path: string }).path;
    expect(path).toContain(join(attachmentsRoot(workspaceRoot), projectId));
    expect(path.endsWith('.png')).toBe(true);
    await expect(stat(path)).resolves.toBeDefined(); // file exists on disk
  });

  it('ignores any client-supplied path — path is always server-generated', async () => {
    const { projectId, ownerId } = await seedProject();
    const v = await addUpload(
      projectId,
      // @ts-expect-error — a malicious extra field is not part of the input contract
      { kind: 'file', label: 'x', bytes: new Uint8Array([1]), mime: 'text/plain', path: '../../escape' },
      { id: ownerId },
      { workspaceRoot },
    );
    const path = (v.payload as { path: string }).path;
    expect(path).not.toContain('escape');
    expect(path).toContain(projectId);
  });

  it('removing an attachment unlinks the on-disk byte then deletes the row (F13)', async () => {
    const { projectId, ownerId } = await seedProject();
    const v = await addUpload(
      projectId,
      { kind: 'file', label: 'x', bytes: new Uint8Array([1, 2]), mime: 'text/plain' },
      { id: ownerId },
      { workspaceRoot },
    );
    const path = (v.payload as { path: string }).path;
    await removeAttachment(projectId, v.id, { id: ownerId }, { workspaceRoot });
    await expect(stat(path)).rejects.toThrow(); // byte gone
    const rows = await getDb().select().from(attachment).where(eq(attachment.id, v.id));
    expect(rows).toHaveLength(0); // row gone
  });

  it('purging a project removes its whole attachment directory (F13)', async () => {
    const { projectId, ownerId } = await seedProject();
    await addUpload(
      projectId,
      { kind: 'file', label: 'x', bytes: new Uint8Array([1]), mime: 'text/plain' },
      { id: ownerId },
      { workspaceRoot },
    );
    const dir = join(attachmentsRoot(workspaceRoot), projectId);
    await expect(readdir(dir)).resolves.toHaveLength(1);
    await purgeProjectAttachments(projectId, { workspaceRoot });
    await expect(readdir(dir)).rejects.toThrow(); // dir gone
  });
});
