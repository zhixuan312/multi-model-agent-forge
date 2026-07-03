import { describe, it, expect } from 'vitest';
import { SPEC_TEMPLATE_SEEDS } from '@/db/seed/team-spec-template';

describe('SPEC_TEMPLATE_SEEDS', () => {
  it('contains exactly 8 templates', () => {
    expect(SPEC_TEMPLATE_SEEDS).toHaveLength(8);
  });

  it('has the correct kinds in order', () => {
    expect(SPEC_TEMPLATE_SEEDS.map((s) => s.kind)).toEqual([
      'context', 'problem', 'goals_requirements', 'alternatives',
      'technical_design', 'testing_plan', 'risks', 'stories_tasks',
    ]);
  });

  it('each seed has label, orderIndex, and non-empty sections', () => {
    for (const seed of SPEC_TEMPLATE_SEEDS) {
      expect(seed.label).toBeTruthy();
      expect(typeof seed.orderIndex).toBe('number');
      expect(Array.isArray(seed.sections)).toBe(true);
      expect(seed.sections.length).toBeGreaterThan(0);
      for (const sec of seed.sections) {
        expect(sec.key).toBeTruthy();
        expect(sec.label).toBeTruthy();
      }
    }
  });

  it('context has 1 section, goals_requirements has 5', () => {
    const context = SPEC_TEMPLATE_SEEDS.find((s) => s.kind === 'context')!;
    expect(context.sections).toHaveLength(1);
    expect(context.sections[0].key).toBe('background');

    const goals = SPEC_TEMPLATE_SEEDS.find((s) => s.kind === 'goals_requirements')!;
    expect(goals.sections).toHaveLength(5);
    expect(goals.sections.map((s) => s.key)).toEqual([
      'goals', 'functional', 'scope', 'constraints', 'success_metrics',
    ]);
  });

  it('orderIndex is sequential 0-7', () => {
    expect(SPEC_TEMPLATE_SEEDS.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
