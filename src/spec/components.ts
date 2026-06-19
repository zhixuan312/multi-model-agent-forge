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
    primaryRoles: ['BO', 'PM'],
    default: true,
    sections: [
      { key: 'background', label: 'Background', prompt: 'What background and current landscape frames this work?', draftHeading: 'Background' },
    ],
  },
  {
    kind: 'problem',
    label: 'Problem',
    primaryRoles: ['BO', 'PM'],
    default: true,
    sections: [
      { key: 'problem', label: 'Problem', prompt: 'What exactly is the problem being solved and why does it matter now?', draftHeading: 'Problem' },
    ],
  },
  {
    kind: 'goals_requirements',
    label: 'Goals & Requirements',
    primaryRoles: ['BO', 'PM'],
    default: true,
    sections: [
      { key: 'goals', label: 'Goals', prompt: 'What are the goals of this work?', draftHeading: 'Goals' },
      { key: 'functional', label: 'Functional requirements', prompt: 'What must the system do (functional requirements)?', draftHeading: 'Functional requirements' },
      { key: 'scope', label: 'Scope', prompt: 'What is in scope and what is explicitly out of scope?', draftHeading: 'Scope' },
      { key: 'constraints', label: 'Constraints', prompt: 'What are the non-functional constraints (performance, security, scalability, etc.)?', draftHeading: 'Constraints' },
      { key: 'success_metrics', label: 'Success metrics', prompt: 'How will success be measured? What are the key metrics?', draftHeading: 'Success metrics' },
    ],
  },
  {
    kind: 'alternatives',
    label: 'Alternatives',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'driving_factors', label: 'Driving factors', prompt: 'What criteria and constraints drive the decision between options?', draftHeading: 'Driving factors' },
      { key: 'options', label: 'Options', prompt: 'What alternative approaches were considered? Describe each option with its trade-offs.', draftHeading: 'Options' },
      { key: 'comparison', label: 'Comparison', prompt: 'How do the options compare against the driving factors? Present a horizontal comparison.', draftHeading: 'Comparison' },
    ],
  },
  {
    kind: 'technical_design',
    label: 'Technical Design',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'current_state', label: 'Current state', prompt: 'What is the current implementation — architecture, data flow, key components? (For greenfield, state that nothing exists.)', draftHeading: 'Current state' },
      { key: 'proposed', label: 'Proposed design', prompt: 'What is the proposed design? Cover architecture, interfaces, data model, and key implementation details.', draftHeading: 'Proposed design' },
      { key: 'impact', label: 'Impact', prompt: 'What breaks, what migrates, and what is the rollout path from current to proposed?', draftHeading: 'Impact' },
    ],
  },
  {
    kind: 'testing_plan',
    label: 'Testing Plan',
    primaryRoles: ['PM', 'SWE'],
    default: true,
    sections: [
      { key: 'strategy', label: 'Test strategy', prompt: 'What is the testing strategy (unit, integration, e2e) and how is regression coverage ensured?', draftHeading: 'Test strategy' },
    ],
  },
  {
    kind: 'risks',
    label: 'Risks & Mitigations',
    primaryRoles: ['SWE', 'PM'],
    default: true,
    sections: [
      { key: 'risks', label: 'Risks', prompt: 'What risks and trade-offs follow from this approach?', draftHeading: 'Risks' },
      { key: 'mitigations', label: 'Mitigations', prompt: 'How are the identified risks mitigated or monitored?', draftHeading: 'Mitigations' },
    ],
  },
  {
    kind: 'stories_tasks',
    label: 'User Stories & Tasks',
    primaryRoles: ['PM', 'SWE'],
    default: true,
    sections: [
      { key: 'user_stories', label: 'User stories', prompt: 'What are the user stories from an end-user perspective? Include acceptance criteria for each.', draftHeading: 'User stories' },
      { key: 'tech_tasks', label: 'Technical tasks', prompt: 'What are the technical tasks needed to implement the design?', draftHeading: 'Technical tasks' },
    ],
  },
] as const;

/** Lookup a template by kind (throws on an unknown kind — fail-fast). */
export function templateForKind(kind: ComponentKind): ComponentTemplate {
  const t = COMPONENT_TEMPLATES.find((c) => c.kind === kind);
  if (!t) throw new Error(`No COMPONENT_TEMPLATE for kind '${kind}'.`);
  return t;
}

/**
 * Document templates (DocuWriter/Google/ADR/PRD patterns) — each a named preset
 * selecting a subset of components. Picking one drives the outline; hand-toggling
 * away from any preset is "Custom" (which can be saved as a new template).
 */
export interface DocTemplate {
  id: string;
  label: string;
  description: string;
  kinds: ComponentKind[];
}

export const DOC_TEMPLATES: readonly DocTemplate[] = [
  {
    id: 'full_spec',
    label: 'Full Specification',
    description: 'Complete spec — context through tasks',
    kinds: ['context', 'problem', 'goals_requirements', 'alternatives', 'technical_design', 'testing_plan', 'risks', 'stories_tasks'],
  },
  {
    id: 'rfc',
    label: 'Request for Comments (RFC)',
    description: 'Proposal with alternatives for review',
    kinds: ['context', 'problem', 'goals_requirements', 'alternatives', 'technical_design', 'risks'],
  },
  {
    id: 'prd',
    label: 'Product Requirements Document (PRD)',
    description: 'Product requirements — the why and what',
    kinds: ['context', 'problem', 'goals_requirements', 'stories_tasks'],
  },
  {
    id: 'adr',
    label: 'Architecture Decision Record (ADR)',
    description: 'Lean decision record — the choice and why',
    kinds: ['context', 'alternatives', 'risks'],
  },
];

/** The default-checked component kinds — the default template (Technical Design Doc). */
export function defaultComponentKinds(): ComponentKind[] {
  return COMPONENT_TEMPLATES.filter((c) => c.default).map((c) => c.kind);
}
