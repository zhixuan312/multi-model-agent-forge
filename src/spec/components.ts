import type { ComponentKind } from '@/db/enums';

/**
 * `COMPONENT_TEMPLATES` (Spec 4 / product.md §8.1) — the canonical component +
 * section structure of a spec. Each template drives BOTH the Q&A section set per
 * component AND the assembled-document heading structure (`draftHeading`).
 *
 * Mapped from product.md §8.1 "contains" + the `spec-sample.html` heading tree.
 * The five `default: true` components are pre-checked at `/spec/outline`; `nfr`
 * and `assumptions` default off. EVERY selected component AND every one of its
 * sections goes through Q&A — depth is guaranteed by the template, not the
 * conversation.
 */

/** One sub-section of a component: drives Q&A and the drafted heading. */
export interface SectionTemplate {
  /** Stable section key (persisted on `component_section.key`). */
  key: string;
  /** Display label (persisted on `component_section.label`; the nav label). */
  label: string;
  /** Seeds Q&A question generation and labels the drafted section. */
  prompt: string;
  /** The `### <heading>` the drafted body sits under in the assembled document. */
  draftHeading: string;
}

/** One component: kind, label, advisory roles, default-checked, ordered sections. */
export interface ComponentTemplate {
  kind: ComponentKind;
  label: string;
  /** Advisory discipline hints (rendered as `RoleChip`s; persisted on `primary_roles`). */
  primaryRoles: string[];
  /** Pre-checked at `/spec/outline` when true. */
  default: boolean;
  sections: SectionTemplate[];
}

export const COMPONENT_TEMPLATES: readonly ComponentTemplate[] = [
  {
    kind: 'context',
    label: 'Context',
    primaryRoles: ['Business user', 'PM'],
    default: true,
    sections: [
      { key: 'background', label: 'Background', prompt: 'What is the background and history that frames this work?', draftHeading: 'Background' },
      { key: 'current_state', label: 'Current state', prompt: 'What is the current state of things today?', draftHeading: 'Current state' },
      { key: 'why_now', label: 'Why now', prompt: 'Why is this the right time to do this work?', draftHeading: 'Why now' },
    ],
  },
  {
    kind: 'problem',
    label: 'Problem statement & goals',
    primaryRoles: ['Business user', 'PM'],
    default: true,
    sections: [
      { key: 'problem', label: 'The problem', prompt: 'What exactly is the problem being solved?', draftHeading: 'The problem' },
      { key: 'goals', label: 'Goals', prompt: 'What are the goals of this work?', draftHeading: 'Goals' },
      { key: 'non_goals', label: 'Non-goals', prompt: 'What is explicitly out of scope / a non-goal?', draftHeading: 'Non-goals' },
      { key: 'success_criteria', label: 'Success criteria', prompt: 'How will success be measured?', draftHeading: 'Success criteria' },
    ],
  },
  {
    kind: 'tech_design',
    label: 'Technical design',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'options', label: 'Options considered', prompt: 'What design options were considered?', draftHeading: 'Options considered' },
      { key: 'selected_option', label: 'Selected option & rationale', prompt: 'Which option was selected and why?', draftHeading: 'Selected option & rationale' },
      { key: 'existing_behaviour', label: 'Existing behaviour', prompt: 'What is the current state of the affected code (existing behaviour)?', draftHeading: 'Existing behaviour (current state of affected code)' },
      { key: 'impact_upstream', label: 'Impact — upstream', prompt: 'What is the impact on upstream services?', draftHeading: 'Impact — upstream services' },
      { key: 'impact_downstream', label: 'Impact — downstream', prompt: 'What is the impact on downstream services?', draftHeading: 'Impact — downstream services' },
      { key: 'impact_sibling', label: 'Impact — sibling', prompt: 'What is the impact on sibling services?', draftHeading: 'Impact — sibling services' },
      { key: 'delta', label: 'The delta', prompt: 'What exactly changes (the delta)?', draftHeading: 'The delta (what changes)' },
      { key: 'flow_charts', label: 'Flow (Mermaid)', prompt: 'Describe the flow. Include a ```mermaid fenced diagram of the flow.', draftHeading: 'Flow (Mermaid)' },
      { key: 'scope', label: 'Scope of work', prompt: 'What is the scope of the work?', draftHeading: 'Scope of work' },
    ],
  },
  {
    kind: 'test_plan',
    label: 'Test plan',
    primaryRoles: ['Business user', 'QE'],
    default: true,
    sections: [
      { key: 'unit', label: 'Unit tests', prompt: 'What unit tests are needed?', draftHeading: 'Unit tests' },
      { key: 'e2e_regression', label: 'e2e / regression', prompt: 'What end-to-end / regression testing is needed?', draftHeading: 'e2e / regression testing' },
      { key: 'integration', label: 'Integration', prompt: 'What cross-service integration testing is needed?', draftHeading: 'Cross-service integration testing' },
      { key: 'acceptance', label: 'Acceptance criteria', prompt: 'What are the acceptance criteria?', draftHeading: 'Acceptance criteria' },
      { key: 'regression_scope', label: 'Regression scope', prompt: 'What is the regression scope?', draftHeading: 'Regression scope' },
    ],
  },
  {
    kind: 'stories_tasks',
    label: 'User stories & tech tasks',
    primaryRoles: ['PM', 'SWE', 'QE'],
    default: true,
    sections: [
      { key: 'user_stories', label: 'User stories', prompt: 'What are the user stories?', draftHeading: 'User stories' },
      { key: 'tech_tasks', label: 'Technical tasks', prompt: 'What are the technical tasks (one repo per task)?', draftHeading: 'Technical tasks (one repo per task)' },
    ],
  },
  {
    kind: 'nfr',
    label: 'Non-functional constraints',
    primaryRoles: [],
    default: false,
    sections: [
      { key: 'constraints', label: 'Constraints', prompt: 'What non-functional constraints apply?', draftHeading: 'Constraints' },
      { key: 'slos', label: 'SLOs / budgets', prompt: 'What SLOs or budgets apply?', draftHeading: 'SLOs / budgets' },
    ],
  },
  {
    kind: 'assumptions',
    label: 'Assumptions & open decisions',
    primaryRoles: [],
    default: false,
    sections: [
      { key: 'assumptions', label: 'Assumptions', prompt: 'What assumptions are being made?', draftHeading: 'Assumptions' },
      { key: 'open_decisions', label: 'Open decisions', prompt: 'What decisions are still open?', draftHeading: 'Open decisions' },
    ],
  },
] as const;

/** Lookup a template by kind (throws on an unknown kind — fail-fast). */
export function templateForKind(kind: ComponentKind): ComponentTemplate {
  const t = COMPONENT_TEMPLATES.find((c) => c.kind === kind);
  if (!t) throw new Error(`No COMPONENT_TEMPLATE for kind '${kind}'.`);
  return t;
}

/** The default-checked component kinds (the five Spec-stage defaults). */
export function defaultComponentKinds(): ComponentKind[] {
  return COMPONENT_TEMPLATES.filter((c) => c.default).map((c) => c.kind);
}
