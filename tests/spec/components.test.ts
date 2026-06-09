import { COMPONENT_TEMPLATES, defaultComponentKinds, templateForKind } from '@/spec/components';
import { COMPONENT_KIND } from '@/db/enums';

describe('COMPONENT_TEMPLATES', () => {
  it('covers exactly the COMPONENT_KIND enum set', () => {
    const kinds = COMPONENT_TEMPLATES.map((t) => t.kind).sort();
    expect(kinds).toEqual([...COMPONENT_KIND].sort());
  });

  it('marks exactly five components as default-checked', () => {
    expect(defaultComponentKinds()).toEqual(['context', 'problem', 'tech_design', 'test_plan', 'stories_tasks']);
  });

  it('tech_design carries the depth sections (existing_behaviour, impacts, delta, scope, flow_charts)', () => {
    const td = templateForKind('tech_design');
    const keys = td.sections.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'options',
        'selected_option',
        'existing_behaviour',
        'impact_upstream',
        'impact_downstream',
        'impact_sibling',
        'delta',
        'flow_charts',
        'scope',
      ]),
    );
  });

  it('test_plan carries unit / e2e_regression / integration', () => {
    const keys = templateForKind('test_plan').sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['unit', 'e2e_regression', 'integration']));
  });

  it('flow_charts prompt instructs a ```mermaid fence', () => {
    const flow = templateForKind('tech_design').sections.find((s) => s.key === 'flow_charts')!;
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
