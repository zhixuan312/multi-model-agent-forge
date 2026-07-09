import { describe, it, expect, vi } from 'vitest';
import { parsePlanRefineResponse } from '@/plan/plan-refine-prompt';

vi.mock('@/sse/event-bus', () => ({
  projectEventBus: { publish: vi.fn(), subscribe: () => () => {} },
}));
vi.mock('@/projects/project-files', () => ({
  readSpecFile: vi.fn().mockResolvedValue(null),
  writeSpec: vi.fn().mockResolvedValue({ filePath: '/fake', version: 1 }),
  readExplorationSummary: vi.fn().mockResolvedValue(null),
}));

describe('plan-refine handler — response parsing', () => {
  it('parses a valid JSON response with chatReply + updatedTaskBody', () => {
    const raw = JSON.stringify({
      chatReply: 'Added query param validation.',
      updatedTaskBody: '### Task 3\n\nAdded Zod validation for query params.',
    });
    const result = parsePlanRefineResponse(raw);
    expect(result.chatReply).toBe('Added query param validation.');
    expect(result.updatedTaskBody).toContain('query params');
  });

  it('falls back to raw text when JSON is malformed', () => {
    const result = parsePlanRefineResponse('Sure, I updated that.');
    expect(result.chatReply).toBe('Sure, I updated that.');
    expect(result.updatedTaskBody).toBeNull();
  });
});

describe('plan-refine handler — registration', () => {
  it('handler is registered after import', async () => {
    await import('@/dispatch/handlers/plan-refine');
    const { getHandler } = await import('@/dispatch/handler-registry');
    const handler = getHandler('plan-refine');
    expect(handler).toBeDefined();
  });
});
