// @vitest-environment node
import { afterEach, beforeEach } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addLink,
  addUpload,
  removeAttachment,
  purgeProjectAttachments,
  AttachmentRejectError,
  attachmentsRoot,
  MAX_ATTACHMENT_BYTES,
} from '@/exploration/attachments';
import { createMockDb } from '../test-utils/mock-db';

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'forge-attach-'));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('attachments', () => {
  it('stores a link as {url} (json) with no disk write', async () => {
    const db = createMockDb({
      'insert:project_attachment': [{ id: 'att-1', projectId: 'proj-1', kind: 'link', label: 'Docs', payload: { url: 'https://example.com/x' }, createdAt: new Date() }],
    });
    const v = await addLink('proj-1', { label: 'Docs', url: 'https://example.com/x' }, { id: 'member-1' }, { db, workspaceRoot });
    expect(v).toMatchObject({ kind: 'link', label: 'Docs' });
    expect((v.payload as { url: string }).url).toBe('https://example.com/x');
  });

  it('rejects a non-http link (415/400 before insert)', async () => {
    const db = createMockDb({});
    await expect(
      addLink('proj-1', { label: 'x', url: 'ftp://nope' }, { id: 'member-1' }, { db, workspaceRoot }),
    ).rejects.toThrow(AttachmentRejectError);
    expect(db._assertCalled('project_attachment', 'insert')).toBe(false);
  });

  it('rejects a disallowed MIME (415) before any disk write', async () => {
    const db = createMockDb({});
    await expect(
      addUpload(
        'proj-1',
        { kind: 'image', label: 'x', bytes: new Uint8Array([1, 2, 3]), mime: 'image/svg+xml' },
        { id: 'member-1' },
        { db, workspaceRoot },
      ),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('rejects an oversized upload (413)', async () => {
    const db = createMockDb({});
    await expect(
      addUpload(
        'proj-1',
        { kind: 'file', label: 'big', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1), mime: 'application/pdf' },
        { id: 'member-1' },
        { db, workspaceRoot },
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('stores a valid image with a SERVER-generated path under the project dir', async () => {
    const db = createMockDb({
      'insert:project_attachment': [{ id: 'att-1', projectId: 'proj-1', kind: 'image', label: 'shot', payload: { path: join(attachmentsRoot(workspaceRoot), 'proj-1', 'img.png') }, createdAt: new Date() }],
    });
    const v = await addUpload(
      'proj-1',
      { kind: 'image', label: 'shot', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      { id: 'member-1' },
        { db, workspaceRoot },
    );
    const path = (v.payload as { path: string }).path;
    expect(path).toContain(join(attachmentsRoot(workspaceRoot), 'proj-1'));
    expect(path.endsWith('.png')).toBe(true);
    await expect(readdir(join(attachmentsRoot(workspaceRoot), 'proj-1'))).resolves.toHaveLength(1);
  });

  it('ignores any client-supplied path — path is always server-generated', async () => {
    const db = createMockDb({
      'insert:project_attachment': [{ id: 'att-1', projectId: 'proj-1', kind: 'file', label: 'x', payload: { path: join(attachmentsRoot(workspaceRoot), 'proj-1', 'file.txt') }, createdAt: new Date() }],
    });
    const v = await addUpload(
      'proj-1',
      // @ts-expect-error — a malicious extra field is not part of the input contract
      { kind: 'file', label: 'x', bytes: new Uint8Array([1]), mime: 'text/plain', path: '../../escape' },
      { id: 'member-1' },
        { db, workspaceRoot },
    );
    const path = (v.payload as { path: string }).path;
    expect(path).not.toContain('escape');
    expect(path).toContain('proj-1');
  });

  it('removing an attachment unlinks the on-disk byte then deletes the row (F13)', async () => {
    const path = join(attachmentsRoot(workspaceRoot), 'proj-1', 'file.txt');
    await mkdir(join(attachmentsRoot(workspaceRoot), 'proj-1'), { recursive: true });
    await writeFile(path, new Uint8Array([1, 2]));
    const db = createMockDb({
      'select:project_attachment': [{ id: 'att-1', projectId: 'proj-1', kind: 'file', label: 'x', payload: { path }, createdAt: new Date() }],
      'delete:project_attachment': [],
    });
    await removeAttachment('proj-1', 'att-1', { id: 'member-1' }, { db, workspaceRoot });
    await expect(stat(path)).rejects.toThrow(); // byte gone
    expect(db._assertCalled('project_attachment', 'delete')).toBe(true);
  });

  it('purging a project removes its whole attachment directory (F13)', async () => {
    const db = createMockDb({
      'select:project_attachment': [{ id: 'att-1', projectId: 'proj-1', kind: 'file', label: 'x', payload: { path: join(workspaceRoot, 'file.txt') }, createdAt: new Date() }],
      'insert:project_attachment': [{ id: 'att-1', projectId: 'proj-1', kind: 'file', label: 'x', payload: { path: join(attachmentsRoot(workspaceRoot), 'proj-1', 'file.txt') }, createdAt: new Date() }],
      'delete:project_attachment': [],
    });
    await addUpload(
      'proj-1',
      { kind: 'file', label: 'x', bytes: new Uint8Array([1]), mime: 'text/plain' },
      { id: 'member-1' },
      { db, workspaceRoot },
    );
    const dir = join(attachmentsRoot(workspaceRoot), 'proj-1');
    await expect(readdir(dir)).resolves.toHaveLength(1);
    await purgeProjectAttachments('proj-1', { workspaceRoot });
    await expect(readdir(dir)).rejects.toThrow(); // dir gone
  });
});
