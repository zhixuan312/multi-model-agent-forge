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
    kind: 'context_scope',
    label: 'Context & scope',
    primaryRoles: ['BO', 'PM'],
    default: true,
    sections: [
      { key: 'background', label: 'Background', prompt: 'What background and current landscape frames this work?', draftHeading: 'Background' },
      { key: 'scope', label: 'In scope / out of scope', prompt: 'What is in scope, and what is explicitly out of scope?', draftHeading: 'Scope' },
    ],
  },
  {
    kind: 'problem_motivation',
    label: 'Problem & motivation',
    primaryRoles: ['BO', 'PM'],
    default: false,
    sections: [
      { key: 'problem', label: 'The problem', prompt: 'What exactly is the problem being solved?', draftHeading: 'The problem' },
      { key: 'why_now', label: 'Why now', prompt: 'Why is this the right time to address it?', draftHeading: 'Why now' },
    ],
  },
  {
    kind: 'goals_nongoals',
    label: 'Goals & non-goals',
    primaryRoles: ['PM'],
    default: true,
    sections: [
      { key: 'goals', label: 'Goals', prompt: 'What are the goals of this work?', draftHeading: 'Goals' },
      { key: 'non_goals', label: 'Non-goals', prompt: 'What is explicitly a non-goal?', draftHeading: 'Non-goals' },
    ],
  },
  {
    kind: 'requirements',
    label: 'Requirements',
    primaryRoles: ['PM', 'QE'],
    default: false,
    sections: [
      { key: 'functional', label: 'Functional requirements', prompt: 'What must the system do (functional requirements)?', draftHeading: 'Functional requirements' },
      { key: 'acceptance', label: 'Acceptance criteria', prompt: 'What are the acceptance criteria?', draftHeading: 'Acceptance criteria' },
    ],
  },
  {
    kind: 'proposed_design',
    label: 'Proposed design',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'overview', label: 'Design overview', prompt: 'Give an overview of the proposed design and key trade-offs.', draftHeading: 'Design overview' },
      { key: 'system_context', label: 'System-context diagram', prompt: 'Describe how this fits the wider system. Include a ```mermaid diagram.', draftHeading: 'System-context diagram' },
      { key: 'details', label: 'Design details', prompt: 'What are the important design details?', draftHeading: 'Design details' },
    ],
  },
  {
    kind: 'interfaces_apis',
    label: 'Interfaces & APIs',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'apis', label: 'API & contract surface', prompt: 'What interfaces/APIs does this expose or consume?', draftHeading: 'Interfaces & APIs' },
    ],
  },
  {
    kind: 'data_storage',
    label: 'Data & storage',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'data_model', label: 'Data model & schema', prompt: 'What is the data model / schema?', draftHeading: 'Data model & schema' },
      { key: 'storage', label: 'Storage & retention', prompt: 'How is data stored, retained, and migrated?', draftHeading: 'Storage & retention' },
    ],
  },
  {
    kind: 'alternatives',
    label: 'Alternatives considered',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'options', label: 'Options considered', prompt: 'What alternative approaches were considered?', draftHeading: 'Options considered' },
      { key: 'rejected', label: 'Why rejected', prompt: 'Why were the alternatives rejected (their trade-offs)?', draftHeading: 'Why rejected' },
    ],
  },
  {
    kind: 'decision_status',
    label: 'Decision & status',
    primaryRoles: ['SWE'],
    default: false,
    sections: [
      { key: 'decision', label: 'The decision', prompt: 'What is the decision, and what forces drove it?', draftHeading: 'Decision' },
      { key: 'status', label: 'Status', prompt: 'What is the status (proposed / accepted / superseded)?', draftHeading: 'Status' },
    ],
  },
  {
    kind: 'cross_cutting',
    label: 'Cross-cutting concerns',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'security', label: 'Security & privacy', prompt: 'What are the security and privacy considerations?', draftHeading: 'Security & privacy' },
      { key: 'observability', label: 'Observability', prompt: 'How is this observed (logs, metrics, traces, alerts)?', draftHeading: 'Observability' },
      { key: 'performance', label: 'Performance & NFRs', prompt: 'What performance / non-functional constraints apply?', draftHeading: 'Performance & NFRs' },
    ],
  },
  {
    kind: 'risks_consequences',
    label: 'Risks & consequences',
    primaryRoles: [],
    default: false,
    sections: [
      { key: 'risks', label: 'Risks & trade-offs', prompt: 'What risks and trade-offs follow from this?', draftHeading: 'Risks & trade-offs' },
      { key: 'open_questions', label: 'Open questions', prompt: 'What questions are still open?', draftHeading: 'Open questions' },
    ],
  },
  {
    kind: 'test_validation',
    label: 'Test & validation',
    primaryRoles: ['QE', 'BO'],
    default: true,
    sections: [
      { key: 'strategy', label: 'Test strategy', prompt: 'What is the testing strategy (unit, integration, e2e)?', draftHeading: 'Test strategy' },
      { key: 'acceptance', label: 'Acceptance & regression', prompt: 'What acceptance and regression coverage is needed?', draftHeading: 'Acceptance & regression' },
    ],
  },
  {
    kind: 'rollout_migration',
    label: 'Rollout & migration',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'rollout', label: 'Rollout plan', prompt: 'How is this rolled out (phases, flags, gates)?', draftHeading: 'Rollout plan' },
      { key: 'migration', label: 'Migration & backout', prompt: 'What migration and backout plan applies?', draftHeading: 'Migration & backout' },
    ],
  },
  {
    kind: 'work_breakdown',
    label: 'Work breakdown',
    primaryRoles: ['PM', 'SWE', 'QE'],
    default: false,
    sections: [
      { key: 'user_stories', label: 'User stories', prompt: 'What are the user stories?', draftHeading: 'User stories' },
      { key: 'tech_tasks', label: 'Technical tasks', prompt: 'What are the technical tasks (one repo per task)?', draftHeading: 'Technical tasks' },
    ],
  },
  {
    kind: 'success_metrics',
    label: 'Success metrics',
    primaryRoles: ['BO', 'PM'],
    default: false,
    sections: [
      { key: 'metrics', label: 'Success metrics', prompt: 'How will success be measured?', draftHeading: 'Success metrics' },
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
    id: 'design_doc',
    label: 'Technical Design Doc',
    description: 'Google-style end-to-end design doc',
    kinds: [
      'context_scope',
      'goals_nongoals',
      'proposed_design',
      'interfaces_apis',
      'data_storage',
      'alternatives',
      'cross_cutting',
      'test_validation',
      'rollout_migration',
    ],
  },
  {
    id: 'rfc',
    label: 'Request for Comments (RFC)',
    description: 'Proposal opened for review',
    kinds: ['context_scope', 'problem_motivation', 'goals_nongoals', 'proposed_design', 'alternatives', 'risks_consequences'],
  },
  {
    id: 'adr',
    label: 'Architecture Decision Record (ADR)',
    description: 'Lean architecture decision record',
    kinds: ['context_scope', 'decision_status', 'alternatives', 'risks_consequences'],
  },
  {
    id: 'tech_spec',
    label: 'Technical Specification',
    description: 'Build-ready implementation detail',
    kinds: ['proposed_design', 'interfaces_apis', 'data_storage', 'work_breakdown', 'test_validation', 'rollout_migration'],
  },
  {
    id: 'prd',
    label: 'Product Requirements Document (PRD)',
    description: 'Product requirements (the why & what)',
    kinds: ['context_scope', 'problem_motivation', 'goals_nongoals', 'requirements', 'success_metrics', 'work_breakdown'],
  },
];

/** The default-checked component kinds — the default template (Technical Design Doc). */
export function defaultComponentKinds(): ComponentKind[] {
  return COMPONENT_TEMPLATES.filter((c) => c.default).map((c) => c.kind);
}
