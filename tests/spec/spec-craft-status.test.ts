// @vitest-environment node
import { vi } from 'vitest';

vi.mock('@/projects/project-files', () => ({
  readSpecFile: vi.fn(),
  readPlanFile: vi.fn(),
}));

import { loadOutline } from '@/spec/spec-core';
import { readSpecFile } from '@/projects/project-files';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

const tplId1 = 'tpl-context', tplId2 = 'tpl-problem';
function mockDbWith() {
  const d = buildInitialDetails();
  d.stages.spec.phases.craft.components = [
    { id: 'c1', templateId: tplId1, approvals: [] },
    { id: 'c2', templateId: tplId2, approvals: [] },
  ];
  return createMockDb({
    'select:project': [{ details: d }],
    'select:team_spec_template': [
      { id: tplId1, kind: 'context', label: 'Context', orderIndex: 0, sections: [] },
      { id: tplId2, kind: 'problem', label: 'Problem', orderIndex: 1, sections: [] },
    ],
  });
}

describe('craft component status reflects real content, not bare skeleton headings', () => {
  it('a spec.md with only empty headings → components are gathering (Drafting…), not drafted (Ready)', async () => {
    // The outline writes all headings up front; the MMA draft batch has not written content yet.
    (readSpecFile as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 1, updatedAt: '', bodyMd: '## Context\n\n## Problem\n' });
    const outline = await loadOutline(mockDbWith(), 'p1');
    expect(outline.find((c) => c.kind === 'context')!.status).toBe('gathering');
    expect(outline.find((c) => c.kind === 'problem')!.status).toBe('gathering');
  });

  it('once a section has real body content → that component is drafted (Ready)', async () => {
    (readSpecFile as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 1, updatedAt: '', bodyMd: '## Context\n\nReal background prose about the team and product.\n\n## Problem\n' });
    const outline = await loadOutline(mockDbWith(), 'p1');
    expect(outline.find((c) => c.kind === 'context')!.status).toBe('drafted');   // has content
    expect(outline.find((c) => c.kind === 'problem')!.status).toBe('gathering'); // still empty
  });
});

/**
 * `primaryRoles` are the discipline chips the craft panel renders beside a component's
 * title (`active.primaryRoles.map(… <RoleChip/>)`). The server hardcoded `[]` for every
 * component, so the chips never appeared — while the data sat in `templateForKind`, the
 * lookup two lines above in the same loop, and was already used for the outline picker's
 * role filter.
 */
describe('a component view carries the roles the panel renders', () => {
  it('populates primaryRoles from the component template', async () => {
    (readSpecFile as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 1, updatedAt: '', bodyMd: '' });
    const outline = await loadOutline(mockDbWith(), 'p1');
    const { templateForKind } = await import('@/spec/components');
    for (const view of outline) {
      expect(view.primaryRoles, view.kind).toEqual(templateForKind(view.kind).primaryRoles);
      expect(view.primaryRoles.length, `${view.kind} has no roles to render`).toBeGreaterThan(0);
    }
  });
});
