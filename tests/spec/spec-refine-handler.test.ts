// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';

/**
 * Real coverage for the `spec-refine` terminal handler.
 *
 * This replaces two files that LOOKED like coverage of it and were not:
 *
 * - `refine-handler.test.ts` never imported the handler at all — it re-tested
 *   `refine-prompt`'s three pure functions (already covered, more thoroughly, in
 *   `refine-prompt.test.ts`) and opened with two cases that asserted `null === null`
 *   and `'session-abc' === null`. Those test JavaScript's `===` operator; they cannot
 *   fail for any state of this codebase.
 * - `chat-integration.test.ts` claimed "DB persistence, SSE event publishing … through
 *   the dispatch handlers", but its handler cases only asserted `getHandler(...)` was
 *   defined. Its "publishes correct event shape" cases BUILT an event literal inside the
 *   test, asserted the literal had the fields just written into it, then pushed to the
 *   captured array by hand and asserted the push. No production code ran.
 *
 * So the handler's actual behaviour — splice spec.md, insert the Forge chat row, publish
 * the SSE event carrying that row's id — was untested behind ~375 lines of tests.
 *
 * These invoke the handler through the registry, exactly as the dispatch layer does.
 */
const { backupArtifact, readSpecFile, writeSpec, publish } = vi.hoisted(() => ({
  backupArtifact: vi.fn(async () => {}),
  readSpecFile: vi.fn(async () => null as { version: number; updatedAt: string; bodyMd: string } | null),
  writeSpec: vi.fn(async (_projectId: string, _bodyMd: string) => ({ filePath: '/fake/spec.md', version: 2 })),
  publish: vi.fn(),
}));

vi.mock('@/projects/project-files', () => ({ backupArtifact, readSpecFile, writeSpec }));
vi.mock('@/sse/event-bus', () => ({ projectEventBus: { publish, subscribe: () => () => {} } }));

await import('@/dispatch/handlers/spec-refine');
const { getHandler } = await import('@/dispatch/handler-registry');

const handler = getHandler('spec-refine')!;
const ctx = { projectId: 'proj-1', request: { componentId: 'comp-1' } } as never;

/** The terminal envelope shape the dispatch layer hands a handler. */
const envelope = (payload: unknown) => ({
  output: { summary: typeof payload === 'string' ? payload : JSON.stringify(payload) },
});

function db() {
  return createMockDb({ 'insert:project_qa_message': [{ id: 'msg-9' }] });
}

/** The row the handler inserted (the `.values(...)` argument). */
function insertedRow(mock: ReturnType<typeof createMockDb>): Record<string, unknown> {
  const call = mock._callsFor('project_qa_message').find((c) => c.method === 'values');
  return (call?.args[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  readSpecFile.mockResolvedValue(null);
});

describe('spec-refine handler — the chat row it persists', () => {
  it('inserts the reply against the component, authored by Forge', async () => {
    const mock = db();
    await handler(mock, ctx, envelope({ chatReply: 'Updated the audience.', questions: [] }));

    const row = insertedRow(mock);
    expect(row.targetId).toBe('comp-1');
    expect(row.projectId).toBe('proj-1');
    expect(row.targetKind).toBe('spec_component');
    expect(row.authorId).toBe(FORGE_MEMBER_ID);
    expect(row.bodyMd).toBe('Updated the audience.');
  });

  it('appends the clarifying questions to the reply body', async () => {
    const mock = db();
    await handler(
      mock,
      ctx,
      envelope({ chatReply: 'Updated.', questions: ['Which division?', 'By when?'] }),
    );

    const body = insertedRow(mock).bodyMd as string;
    expect(body).toContain('Updated.');
    expect(body).toContain('Which division?');
    expect(body).toContain('By when?');
    expect(insertedRow(mock).meta).toMatchObject({ questions: ['Which division?', 'By when?'] });
  });

  it('records whether the section was rewritten, for the chat row meta', async () => {
    const withEdit = db();
    readSpecFile.mockResolvedValue({ version: 1, updatedAt: '', bodyMd: '## Context\n\n### Background\n\nold\n' });
    await handler(withEdit, ctx, envelope({ chatReply: 'ok', updatedSectionMd: '### Background\n\nnew', questions: [] }));
    expect(insertedRow(withEdit).meta).toMatchObject({ sectionUpdated: true });

    const noEdit = db();
    await handler(noEdit, ctx, envelope({ chatReply: 'ok', questions: [] }));
    expect(insertedRow(noEdit).meta).toMatchObject({ sectionUpdated: false });
  });

  it('falls back to the raw text when MMA returns prose instead of JSON', async () => {
    const mock = db();
    await handler(mock, ctx, envelope('I updated the section to reflect CPFB users.'));
    expect(insertedRow(mock).bodyMd).toBe('I updated the section to reflect CPFB users.');
    expect(writeSpec).not.toHaveBeenCalled();
  });
});

describe('spec-refine handler — the SSE event it publishes', () => {
  it('publishes chat.message carrying the id of the row it just inserted', async () => {
    // The id matters: the client dedups on it, so publishing a placeholder would make the
    // author see their own message twice.
    await handler(db(), ctx, envelope({ chatReply: 'Done.', questions: [] }));

    expect(publish).toHaveBeenCalledTimes(1);
    const [projectId, event] = publish.mock.calls[0] as [string, Record<string, unknown>];
    expect(projectId).toBe('proj-1');
    expect(event).toMatchObject({
      type: 'chat.message',
      scope: 'spec_component',
      targetId: 'comp-1',
      message: { id: 'msg-9', sender: 'forge', authorId: 'forge', authorName: 'Forge' },
    });
  });

  it('publishes the SAME body it persisted, questions included', async () => {
    const mock = db();
    await handler(mock, ctx, envelope({ chatReply: 'Updated.', questions: ['Which division?'] }));
    const event = (publish.mock.calls[0] as [string, { message: { bodyMd: string } }])[1];
    expect(event.message.bodyMd).toBe(insertedRow(mock).bodyMd);
  });
});

describe('spec-refine handler — the spec file it rewrites', () => {
  it('does NOT touch spec.md when the response carries no section edit', async () => {
    await handler(db(), ctx, envelope({ chatReply: 'Just answering.', questions: [] }));
    expect(backupArtifact).not.toHaveBeenCalled();
    expect(writeSpec).not.toHaveBeenCalled();
  });

  it('backs the artifact up BEFORE writing, never the other way round', async () => {
    readSpecFile.mockResolvedValue({ version: 1, updatedAt: '', bodyMd: '## Context\n\n### Background\n\nold body\n' });
    await handler(db(), ctx, envelope({ chatReply: 'ok', updatedSectionMd: '### Background\n\nnew body', questions: [] }));

    expect(backupArtifact).toHaveBeenCalledWith('proj-1', 'spec.md');
    expect(backupArtifact.mock.invocationCallOrder[0]).toBeLessThan(writeSpec.mock.invocationCallOrder[0]);
  });

  it('replaces only the named section, leaving the rest of the spec intact', async () => {
    readSpecFile.mockResolvedValue({
      version: 1,
      updatedAt: '',
      bodyMd: '## Context\n\n### Background\n\nold body\n\n## Problem\n\n### Problem\n\nuntouched problem\n',
    });
    await handler(db(), ctx, envelope({ chatReply: 'ok', updatedSectionMd: '### Background\n\nnew body', questions: [] }));

    const written = writeSpec.mock.calls[0][1] as string;
    expect(written).toContain('new body');
    expect(written).not.toContain('old body');
    expect(written).toContain('untouched problem'); // the other component survives
    expect(written).toContain('## Problem');
  });

  it('skips the write when there is no spec.md to splice into', async () => {
    readSpecFile.mockResolvedValue(null);
    await handler(db(), ctx, envelope({ chatReply: 'ok', updatedSectionMd: '### Background\n\nnew', questions: [] }));
    expect(writeSpec).not.toHaveBeenCalled();
    // The chat row is still written — the member gets a reply either way.
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
