import { COMPONENT_TEMPLATES, DOC_TEMPLATES, defaultComponentKinds, templateForKind } from '@/spec/components';
import { COMPONENT_KIND } from '@/db/enums';

describe('COMPONENT_TEMPLATES', () => {
  it('covers exactly the COMPONENT_KIND enum set', () => {
    const kinds = COMPONENT_TEMPLATES.map((t) => t.kind).sort();
    expect(kinds).toEqual([...COMPONENT_KIND].sort());
  });

  it('default-checked kinds match the Full Specification template', () => {
    expect(defaultComponentKinds()).toEqual([
      'context',
      'problem',
      'goals_requirements',
      'alternatives',
      'technical_design',
      'testing_plan',
      'risks',
      'stories_tasks',
    ]);
  });

  it('technical_design carries current_state / proposed / impact', () => {
    const keys = templateForKind('technical_design').sections.map((s) => s.key);
    expect(keys).toEqual(['current_state', 'proposed', 'impact']);
  });

  it('testing_plan carries strategy', () => {
    const keys = templateForKind('testing_plan').sections.map((s) => s.key);
    expect(keys).toEqual(['strategy']);
  });

  it('every section has a non-empty draftHeading', () => {
    for (const t of COMPONENT_TEMPLATES) {
      for (const s of t.sections) {
        expect(s.draftHeading.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('DOC_TEMPLATES', () => {
  it('every template references only known component kinds', () => {
    const known = new Set<string>(COMPONENT_KIND);
    for (const t of DOC_TEMPLATES) {
      for (const k of t.kinds) expect(known.has(k)).toBe(true);
    }
  });
});

/**
 * "Full Specification" means every component kind. Written out as a literal, a kind added
 * to COMPONENT_KIND and forgotten here would leave the preset quietly not full — the same
 * fail-quiet direction as a completion guard that stops checking a stage.
 */
describe('the Full Specification preset covers every kind', () => {
  it('matches COMPONENT_KIND exactly, whatever it holds', async () => {
    const { COMPONENT_KIND } = await import('@/db/enums');
    const full = DOC_TEMPLATES.find((t) => t.id === 'full_spec');
    expect(full, 'the full_spec preset is gone').toBeDefined();
    expect([...full!.kinds].sort()).toEqual([...COMPONENT_KIND].sort());
  });

  it('every preset names only real kinds', async () => {
    const { COMPONENT_KIND } = await import('@/db/enums');
    for (const t of DOC_TEMPLATES) {
      for (const k of t.kinds) {
        expect(COMPONENT_KIND, `${t.id} names an unknown kind "${k}"`).toContain(k);
      }
    }
  });
});
