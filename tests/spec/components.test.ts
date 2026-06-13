import { COMPONENT_TEMPLATES, DOC_TEMPLATES, defaultComponentKinds, templateForKind } from '@/spec/components';
import { COMPONENT_KIND } from '@/db/enums';

describe('COMPONENT_TEMPLATES', () => {
  it('covers exactly the COMPONENT_KIND enum set', () => {
    const kinds = COMPONENT_TEMPLATES.map((t) => t.kind).sort();
    expect(kinds).toEqual([...COMPONENT_KIND].sort());
  });

  it('default-checked kinds are the Technical Design Doc template', () => {
    expect(defaultComponentKinds()).toEqual([
      'context_scope',
      'goals_nongoals',
      'proposed_design',
      'interfaces_apis',
      'data_storage',
      'alternatives',
      'cross_cutting',
      'test_validation',
      'rollout_migration',
    ]);
  });

  it('proposed_design carries overview / system_context / details', () => {
    const keys = templateForKind('proposed_design').sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['overview', 'system_context', 'details']));
  });

  it('test_validation carries strategy / acceptance', () => {
    const keys = templateForKind('test_validation').sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['strategy', 'acceptance']));
  });

  it('system_context prompt instructs a ```mermaid fence', () => {
    const flow = templateForKind('proposed_design').sections.find((s) => s.key === 'system_context')!;
    expect(flow.prompt.toLowerCase()).toContain('mermaid');
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
