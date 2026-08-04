// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '../test-utils/mock-db';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';

/**
 * Real coverage for the `plan-refine` terminal handler.
 *
 * This file LOOKED like coverage of it and was not. All three of its cases were covered
 * elsewhere, and none touched the handler:
 *
 *  - two re-tested `parsePlanRefineResponse`, already covered more thoroughly in
 *    `plan-refine-prompt.test.ts` (which also pins the empty-`chatReply` case, the
 *    non-string body, and the snake_case keys);
 *  - the third asserted `getHandler('plan-refine')` is defined — which
 *    `handler-registration.test.ts` already asserts for all fifteen handlers, after
 *    awaiting `ensureHandlersRegistered()` rather than a bare import.
 *
 * Its two `vi.mock` calls were the fossil: mocks for `event-bus` and `project-files`, the
 * modules the handler writes through, in a file that never ran it.
 *
 * So the handler's behaviour — splice plan.md, insert the Forge chat row, publish the SSE
 * event carrying that row's id — was untested, while its SPEC sibling
 * (`spec-refine-handler.test.ts`) invokes its handler through the registry and asserts all
 * three. Same asymmetry as `guardProjectRead` having no behavioural test beside
 * `guardProjectWrite`'s seventeen.
 *
 * These invoke the handler through the registry, exactly as the dispatch layer does.
 */
const { replaceTaskSection, publish } = vi.hoisted(() => ({
  replaceTaskSection: vi.fn(async () => {}),
  publish: vi.fn(),
}));

vi.mock('@/plan/plan-file-ops', () => ({ replaceTaskSection }));
vi.mock('@/sse/event-bus', () => ({ projectEventBus: { publish, subscribe: () => () => {} } }));

await import('@/dispatch/handlers/plan-refine');
const { getHandler } = await import('@/dispatch/handler-registry');
const { buildInitialDetails } = await import('@/details/schema');

const handler = getHandler('plan-refine')!;
const ctx = { projectId: 'proj-1', request: { taskId: 't1' } } as never;

/** The terminal envelope shape the dispatch layer hands a handler. */
const envelope = (payload: unknown) => ({
  output: { summary: typeof payload === 'string' ? payload : JSON.stringify(payload) },
});

/** A project whose plan carries the task the refine targets. */
function db(taskId = 't1', title = 'Task 3: Add validation') {
  const d = buildInitialDetails();
  // `pending`, not `proposed` — the latter is not in PLAN_TASK_STATUS and `validateDetails`
  // rejects it, which is what a `as never` cast hides until the handler actually parses.
  d.stages.plan.phases.refine.tasks = [
    { id: taskId, title, status: 'pending', approvals: [], attempts: [], reviewPolicy: 'reviewed' },
  ];
  return createMockDb({
    'select:project': [{ details: d }],
    'insert:project_qa_message': [{ id: 'msg-9' }],
  });
}

/** The row the handler inserted (the `.values(...)` argument). */
function insertedRow(mock: ReturnType<typeof createMockDb>): Record<string, unknown> {
  const call = mock._callsFor('project_qa_message').find((c) => c.method === 'values');
  return (call?.args[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => vi.clearAllMocks());

describe('plan-refine handler — the revised task body', () => {
  it('splices the revision into plan.md under the task’s own heading', async () => {
    await handler(db(), ctx, envelope({ chatReply: 'Done.', updatedTaskBody: '### Task 3\n\nRevised.' }));
    // Addressed by TITLE, which is what `replaceTaskSection` matches on — a task id would
    // find nothing in the markdown.
    expect(replaceTaskSection).toHaveBeenCalledWith('proj-1', 'Task 3: Add validation', '### Task 3\n\nRevised.');
  });

  it('writes nothing when the model returned no revision', async () => {
    await handler(db(), ctx, envelope({ chatReply: 'No changes needed.' }));
    expect(replaceTaskSection).not.toHaveBeenCalled();
  });

  /**
   * The task can be gone by the time the refine lands (a plan re-authored while the
   * dispatch was in flight). Writing then would splice a heading that no longer exists.
   */
  it('writes nothing when the task is no longer in the plan', async () => {
    await handler(db('other-task'), ctx, envelope({ chatReply: 'Done.', updatedTaskBody: '### Task 3\n\nRevised.' }));
    expect(replaceTaskSection).not.toHaveBeenCalled();
  });
});

describe('plan-refine handler — the Forge chat row', () => {
  it('inserts the reply against the task, authored by Forge', async () => {
    const d = db();
    await handler(d, ctx, envelope({ chatReply: 'Added query param validation.', updatedTaskBody: null }));
    expect(insertedRow(d)).toMatchObject({
      targetId: 't1',
      projectId: 'proj-1',
      targetKind: 'plan_task',
      authorId: FORGE_MEMBER_ID,
      bodyMd: 'Added query param validation.',
    });
  });

  /**
   * `parsePlanRefineResponse` deliberately keeps `chatReply: ''` rather than inventing a
   * note, "so the handler supplies the default" — this is the half that supplies it. A blank
   * bubble in the task chat is the failure it prevents.
   */
  it('supplies a default note when the model returned only a revision', async () => {
    const d = db();
    await handler(d, ctx, envelope({ chatReply: '', updatedTaskBody: '### Task 3\n\nRevised.' }));
    expect(insertedRow(d).bodyMd).toBe('Updated the task.');
  });

  /** The rail reads this to show whether the task itself changed, not just the chat. */
  it('records on the message whether the task was updated', async () => {
    const withRevision = db();
    await handler(withRevision, ctx, envelope({ chatReply: 'Done.', updatedTaskBody: '### Task 3\n\nR.' }));
    expect(insertedRow(withRevision).meta).toEqual({ taskUpdated: true });

    vi.clearAllMocks();
    const without = db();
    await handler(without, ctx, envelope({ chatReply: 'Done.' }));
    expect(insertedRow(without).meta).toEqual({ taskUpdated: false });
  });
});

describe('plan-refine handler — the SSE event', () => {
  it('publishes the message the reader will fetch, carrying the inserted row’s id', async () => {
    const d = db();
    await handler(d, ctx, envelope({ chatReply: 'Done.', updatedTaskBody: null }));
    expect(publish).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      type: 'chat.message',
      scope: 'plan_task',
      targetId: 't1',
      // The id must be the row that was just written: the client dedupes on it, so a
      // fabricated or missing id shows the member a duplicate of their own message.
      message: expect.objectContaining({ id: 'msg-9', sender: 'forge', authorId: FORGE_MEMBER_ID }),
    }));
  });

  it('publishes the same text it persisted, default included', async () => {
    const d = db();
    await handler(d, ctx, envelope({ chatReply: '', updatedTaskBody: '### Task 3\n\nR.' }));
    const event = publish.mock.calls[0]![1] as { message: { bodyMd: string } };
    expect(event.message.bodyMd).toBe(insertedRow(d).bodyMd);
    expect(event.message.bodyMd).toBe('Updated the task.');
  });
});
