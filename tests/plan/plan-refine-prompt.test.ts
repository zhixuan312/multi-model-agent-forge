import { describe, it, expect } from 'vitest';
import { buildPlanRefinePrompt, parsePlanRefineResponse } from '@/plan/plan-refine-prompt';

describe('buildPlanRefinePrompt', () => {
  it('produces a 6-part prompt with Role/Task/Context/Input/Constraints/Output', () => {
    const { system, user } = buildPlanRefinePrompt({
      taskTitle: 'Task 3: Add validation middleware',
      taskBody: '### Task 3\n\nAdd Zod validation to the POST endpoint.',
      userMessage: 'Can we also validate the query params?',
      specMd: '# Spec\n## Goals\nValidate all inputs.',
    });
    expect(system).toContain('Role:');
    expect(system).toContain('Task:');
    expect(system).toContain('Constraints:');
    expect(system).toContain('Output format:');
    expect(user).toContain('Context:');
    expect(user).toContain('Input:');
  });

  it('includes the task body and user message in the prompt', () => {
    const { user } = buildPlanRefinePrompt({
      taskTitle: 'Task 1: Setup',
      taskBody: 'Install dependencies and configure TypeScript.',
      userMessage: 'Use pnpm instead of npm.',
      specMd: '# Spec',
    });
    expect(user).toContain('Install dependencies');
    expect(user).toContain('Use pnpm instead of npm');
  });

  it('includes the spec for grounding', () => {
    const { user } = buildPlanRefinePrompt({
      taskTitle: 'Task 1',
      taskBody: 'body',
      userMessage: 'feedback',
      specMd: '# Full Specification\n## Technical Design',
    });
    expect(user).toContain('Full Specification');
  });
});

describe('parsePlanRefineResponse', () => {
  it('parses valid JSON with chatReply and updatedTaskBody', () => {
    const raw = JSON.stringify({
      chatReply: 'Updated the task to use pnpm.',
      updatedTaskBody: '### Task 1\n\nUse pnpm to install.',
    });
    const result = parsePlanRefineResponse(raw);
    expect(result.chatReply).toBe('Updated the task to use pnpm.');
    expect(result.updatedTaskBody).toBe('### Task 1\n\nUse pnpm to install.');
  });

  it('handles markdown-wrapped JSON', () => {
    const raw = '```json\n{"chatReply":"Done.","updatedTaskBody":"body"}\n```';
    const result = parsePlanRefineResponse(raw);
    expect(result.chatReply).toBe('Done.');
    expect(result.updatedTaskBody).toBe('body');
  });

  it('falls back to raw text as chatReply when JSON fails', () => {
    const raw = 'I updated the task.';
    const result = parsePlanRefineResponse(raw);
    expect(result.chatReply).toBe('I updated the task.');
    expect(result.updatedTaskBody).toBeNull();
  });

  it('handles snake_case keys (chat_reply, updated_task_body)', () => {
    const raw = JSON.stringify({ chat_reply: 'Done.', updated_task_body: '# Revised' });
    const result = parsePlanRefineResponse(raw);
    expect(result.chatReply).toBe('Done.');
    expect(result.updatedTaskBody).toBe('# Revised');
  });

  it('returns null updatedTaskBody when field is missing', () => {
    const raw = JSON.stringify({ chatReply: 'No changes needed.' });
    const result = parsePlanRefineResponse(raw);
    expect(result.chatReply).toBe('No changes needed.');
    expect(result.updatedTaskBody).toBeNull();
  });

  /**
   * The revision is the expensive half of the response. Gating on `chatReply` alone threw
   * the whole thing away when the model left the covering note empty — the task body lost,
   * and the raw JSON shown to the user as if it were the chat reply.
   */
  it('keeps a revised task body that arrives without a covering note', () => {
    const raw = JSON.stringify({ chatReply: '', updatedTaskBody: '### Task 1\n\nRevised.' });
    const result = parsePlanRefineResponse(raw);
    expect(result.updatedTaskBody).toBe('### Task 1\n\nRevised.');
    // The handler supplies the note when there is none, so this stays empty rather than
    // carrying a second copy of that default.
    expect(result.chatReply).toBe('');
  });

  it('ignores a non-string task body instead of writing it to plan.md', () => {
    // `replaceTaskSection` calls `newBody.trim()` and writes the result to the file, so a
    // shape that is not a string must never get that far.
    for (const body of [{ md: 'x' }, ['x'], 42, true]) {
      const result = parsePlanRefineResponse(JSON.stringify({ chatReply: 'Done.', updatedTaskBody: body }));
      expect(result.updatedTaskBody).toBeNull();
    }
  });

  it('treats an all-whitespace body as no revision', () => {
    const result = parsePlanRefineResponse(JSON.stringify({ chatReply: 'Done.', updatedTaskBody: '   ' }));
    expect(result.updatedTaskBody).toBeNull();
  });

  it('trims whitespace from raw text fallback', () => {
    const result = parsePlanRefineResponse('  whitespace response  ');
    expect(result.chatReply).toBe('whitespace response');
  });

  it('handles empty string input', () => {
    const result = parsePlanRefineResponse('');
    expect(result.chatReply).toBe('');
    expect(result.updatedTaskBody).toBeNull();
  });
});

describe('buildPlanRefinePrompt edge cases', () => {
  it('works without specMd (no Context block)', () => {
    const { user } = buildPlanRefinePrompt({
      taskTitle: 'Task 1',
      taskBody: 'body',
      userMessage: 'feedback',
    });
    expect(user).not.toContain('Specification');
    expect(user).toContain('Task 1');
    expect(user).toContain('feedback');
  });

  it('includes TDD constraint in system prompt', () => {
    const { system } = buildPlanRefinePrompt({
      taskTitle: 'Task 1',
      taskBody: 'body',
      userMessage: 'feedback',
    });
    expect(system).toContain('TDD');
  });
});
