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
