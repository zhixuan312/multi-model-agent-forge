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
});
