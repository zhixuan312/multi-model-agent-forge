import { describe, expect, it, vi } from 'vitest';

const { confirmComponents, captureIntent, ensureSpecStage, saveBrief } = vi.hoisted(() => ({
  confirmComponents: vi.fn(async (..._a: unknown[]) => {}),
  captureIntent: vi.fn(async () => {}),
  ensureSpecStage: vi.fn(async () => {}),
  saveBrief: vi.fn(async () => {}),
}));
vi.mock('@/spec/orchestrator', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  confirmComponents,
}));
vi.mock('@/spec/spec-core', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  captureIntent,
  ensureSpecStage,
}));
vi.mock('@/exploration/explore-core', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  saveBrief,
}));
vi.mock('@/projects/project-workspace', () => ({
  resolveProjectWorkspaceRoot: async () => '/tmp/ws',
}));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: async () => ({}) }));

import { executeDetailsAction } from '@/automation/details-actions';
import { InvalidActionInput } from '@/automation/action-errors';
import type { AutoAction } from '@/automation/details-resolver';
import { COMPONENT_KIND } from '@/db/enums';
import { createMockDb } from '../test-utils/mock-db';

const act = (kind: string, data: Record<string, unknown>) =>
  ({ kind, note: '', stage: 'spec', phase: 'outline', data }) as unknown as AutoAction;

/**
 * `data` reaches these effects as `Record<string, unknown>` — the transition schema
 * validates the action KIND, never the payload. So each effect owns its own payload
 * validation, and must REJECT rather than cast.
 *
 * `select_components` used to pass its kinds through `as never`. `confirmComponents`
 * then resolved them against the template table and silently dropped whatever didn't
 * match, so a bad kind returned 200 while the component quietly went missing — and an
 * all-invalid list wiped the unapproved selection with no error at all.
 */
describe('action payloads are validated, not cast', () => {
  it('rejects an unknown component kind instead of silently dropping it', async () => {
    await expect(
      executeDetailsAction('p', act('select_components', { kinds: ['not_a_kind'] }), createMockDb()),
    ).rejects.toBeInstanceOf(InvalidActionInput);
    expect(confirmComponents).not.toHaveBeenCalled();
  });

  it('rejects a partly-valid list — a dropped component is never a success', async () => {
    await expect(
      executeDetailsAction('p', act('select_components', { kinds: [COMPONENT_KIND[0], 'nope'] }), createMockDb()),
    ).rejects.toThrow(/nope/);
    expect(confirmComponents).not.toHaveBeenCalled();
  });

  it('rejects a non-string kind', async () => {
    await expect(
      executeDetailsAction('p', act('select_components', { kinds: [7] }), createMockDb()),
    ).rejects.toBeInstanceOf(InvalidActionInput);
  });

  it('accepts every kind the enum declares', async () => {
    confirmComponents.mockClear();
    await executeDetailsAction('p', act('select_components', { kinds: [...COMPONENT_KIND] }), createMockDb());
    expect(confirmComponents).toHaveBeenCalledOnce();
    expect(confirmComponents.mock.calls[0][2]).toEqual([...COMPONENT_KIND]);
  });

  it('reports an over-long brief as invalid INPUT, not a server fault', async () => {
    await expect(
      executeDetailsAction('p', act('set_brief', { text: 'x'.repeat(100_001) }), createMockDb()),
    ).rejects.toBeInstanceOf(InvalidActionInput);
    expect(saveBrief).not.toHaveBeenCalled();
  });
});
