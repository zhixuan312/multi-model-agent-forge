// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDiscoverTerminalLabel } from '@/details/project-event-labels';
import { createMockDb } from '../test-utils/mock-db';

// buildDiscoverTerminalLabel turns a discover batch's request into the settled
// activity-line label. The distinguishing rule: sibling tasks of the same kind
// (e.g. 4 investigations of one repo) must NOT collapse into identical labels —
// each carries a short focus (the propose-time `title`, or a derived fallback from
// the prompt). Research/recall gain a subject the same way.
describe('buildDiscoverTerminalLabel', () => {
  const repoDb = () => createMockDb({ 'select:workspace_repo': [{ name: 'self_service_demo' }] });

  it('investigate with a title → repo + focus', async () => {
    const label = await buildDiscoverTerminalLabel(repoDb(), {
      taskKind: 'investigate', targetRepoId: 'r1', title: 'DB connection & config',
    });
    expect(label).toBe('Investigated self_service_demo — DB connection & config');
  });

  it('investigate without a title derives a focus from the prompt (distinguishes siblings)', async () => {
    const label = await buildDiscoverTerminalLabel(repoDb(), {
      taskKind: 'investigate', targetRepoId: 'r1',
      prompt: 'How does the backend connect to the database? Identify the client and config.',
    });
    expect(label.startsWith('Investigated self_service_demo — ')).toBe(true);
    expect(label).not.toBe('Investigated self_service_demo');
  });

  it('investigate with neither title nor prompt → bare repo label', async () => {
    const label = await buildDiscoverTerminalLabel(repoDb(), { taskKind: 'investigate', targetRepoId: 'r1' });
    expect(label).toBe('Investigated self_service_demo');
  });

  it('investigate with no repo and no focus → generic fallback', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), { taskKind: 'investigate' });
    expect(label).toBe('Investigated a repository');
  });

  it('research with a title → Researched — focus', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), {
      taskKind: 'research', title: 'JSON-file data-layer patterns',
    });
    expect(label).toBe('Researched — JSON-file data-layer patterns');
  });

  it('research without a focus → bare verb', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), { taskKind: 'research' });
    expect(label).toBe('Researched');
  });

  it('journal with a title → Recalled — focus', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), {
      taskKind: 'journal', title: 'DB-free demo decisions',
    });
    expect(label).toBe('Recalled — DB-free demo decisions');
  });

  it('journal without a focus → Recalled learnings', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), { taskKind: 'journal' });
    expect(label).toBe('Recalled learnings');
  });

  it('a long prompt-derived focus is trimmed to a compact label', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), {
      taskKind: 'research',
      prompt: 'Patterns for backing an application data layer with static JSON files instead of a relational database including write handling and caching strategies',
    });
    expect(label.length).toBeLessThanOrEqual('Researched — '.length + 61);
    expect(label.startsWith('Researched — ')).toBe(true);
  });
});
