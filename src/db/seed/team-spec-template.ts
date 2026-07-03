import { type Db } from '@/db/client';
import { teamSpecTemplate } from '@/db/schema/team';

interface SectionDef {
  key: string;
  label: string;
}

interface TemplateSeed {
  kind: string;
  label: string;
  orderIndex: number;
  sections: SectionDef[];
}

export const SPEC_TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    kind: 'context',
    label: 'Context',
    orderIndex: 0,
    sections: [{ key: 'background', label: 'Background' }],
  },
  {
    kind: 'problem',
    label: 'Problem statement',
    orderIndex: 1,
    sections: [{ key: 'problem', label: 'Problem' }],
  },
  {
    kind: 'goals_requirements',
    label: 'Goals & Requirements',
    orderIndex: 2,
    sections: [
      { key: 'goals', label: 'Goals' },
      { key: 'functional', label: 'Functional requirements' },
      { key: 'scope', label: 'Scope' },
      { key: 'constraints', label: 'Constraints' },
      { key: 'success_metrics', label: 'Success metrics' },
    ],
  },
  {
    kind: 'alternatives',
    label: 'Alternatives',
    orderIndex: 3,
    sections: [
      { key: 'driving_factors', label: 'Driving factors' },
      { key: 'options', label: 'Options' },
      { key: 'comparison', label: 'Comparison' },
    ],
  },
  {
    kind: 'technical_design',
    label: 'Technical Design',
    orderIndex: 4,
    sections: [
      { key: 'current_state', label: 'Current state' },
      { key: 'proposed', label: 'Proposed design' },
      { key: 'impact', label: 'Impact' },
    ],
  },
  {
    kind: 'testing_plan',
    label: 'Testing Plan',
    orderIndex: 5,
    sections: [{ key: 'strategy', label: 'Test strategy' }],
  },
  {
    kind: 'risks',
    label: 'Risks',
    orderIndex: 6,
    sections: [
      { key: 'risks', label: 'Risks' },
      { key: 'mitigations', label: 'Mitigations' },
    ],
  },
  {
    kind: 'stories_tasks',
    label: 'User Stories & Tasks',
    orderIndex: 7,
    sections: [{ key: 'user_stories', label: 'User stories' }],
  },
];

export async function seedTeamSpecTemplates(db: Db): Promise<void> {
  for (const seed of SPEC_TEMPLATE_SEEDS) {
    await db
      .insert(teamSpecTemplate)
      .values({
        kind: seed.kind,
        label: seed.label,
        orderIndex: seed.orderIndex,
        sections: seed.sections,
      })
      .onConflictDoNothing();
  }
}
