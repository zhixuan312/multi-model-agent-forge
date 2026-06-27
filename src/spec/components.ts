import type { ComponentKind } from '@/db/enums';

/**
 * Spec component templates — the canonical component + section structure. Each
 * template drives the Outline picker, the Craft auto-draft prompt, and the
 * assembled-document heading structure (`draftHeading`). All 8 components are
 * default-checked; the user can toggle them off in the Outline phase.
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
      { key: 'background', label: 'Background', prompt: 'What background and current landscape frames this work? Format: 2-3 paragraphs of plain prose. Name the team, product, and key stakeholders.', draftHeading: 'Background' },
    ],
  },
  {
    kind: 'problem',
    label: 'Problem',
    primaryRoles: ['BO', 'PM'],
    default: true,
    sections: [
      { key: 'problem', label: 'Problem', prompt: 'What exactly is the problem being solved and why does it matter now? Format: a clear problem statement (1-2 sentences bold), then the impact and urgency in prose.', draftHeading: 'Problem' },
    ],
  },
  {
    kind: 'goals_requirements',
    label: 'Goals & Requirements',
    primaryRoles: ['BO', 'PM'],
    default: true,
    sections: [
      { key: 'goals', label: 'Goals', prompt: 'What are the goals of this work? Format: numbered list, each goal as a clear outcome statement (not a task).', draftHeading: 'Goals' },
      { key: 'functional', label: 'Functional requirements', prompt: 'What must the system do? Format: bulleted list grouped by area. Each requirement starts with "The system shall/must..."', draftHeading: 'Functional requirements' },
      { key: 'scope', label: 'Scope', prompt: 'What is in scope and what is explicitly out of scope? Format: two sections — "In scope" (bulleted) and "Out of scope" (bulleted with brief reason for each exclusion).', draftHeading: 'Scope' },
      { key: 'constraints', label: 'Constraints', prompt: 'What are the non-functional constraints? Format: bulleted list, each prefixed with category (Performance, Security, Scalability, Compatibility, etc.).', draftHeading: 'Constraints' },
      { key: 'success_metrics', label: 'Success metrics', prompt: 'How will success be measured? Format: table with columns: Metric | Target | How measured.', draftHeading: 'Success metrics' },
    ],
  },
  {
    kind: 'alternatives',
    label: 'Alternatives',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'driving_factors', label: 'Driving factors', prompt: 'What criteria drive the decision? Format: numbered list of factors, each with a brief explanation of why it matters and its relative weight (must-have vs nice-to-have). ONLY list the decision criteria here — do NOT include options, evaluations, comparisons, or verdicts (those have their own sections below).', draftHeading: 'Driving factors' },
      { key: 'options', label: 'Options', prompt: 'What approaches were considered? Format: for each option use a subheading (#### Option A: Name), then a brief description. Under each option, evaluate it against EVERY driving factor defined above — for each factor state how well this option satisfies it (✅ strong / ⚠️ partial / ❌ weak) with a one-line explanation.', draftHeading: 'Options' },
      { key: 'comparison', label: 'Comparison', prompt: 'Side-by-side comparison table. Format: markdown table with driving factors as rows and options as columns. Use ✅/⚠️/❌ for each cell. The CHOSEN option column must be wrapped in **bold** headers (e.g. **Option B ✓**) to highlight the recommendation. Add a final row "Verdict" with the reasoning for the choice.', draftHeading: 'Comparison' },
    ],
  },
  {
    kind: 'technical_design',
    label: 'Technical Design',
    primaryRoles: ['SWE'],
    default: true,
    sections: [
      { key: 'current_state', label: 'Current state', prompt: 'What is the current implementation? Format: describe architecture, data flow, and key components. Reference specific files/modules. MUST include a ```mermaid diagram showing the current architecture/data flow. For greenfield, state that nothing exists (no diagram needed).', draftHeading: 'Current state' },
      { key: 'proposed', label: 'Proposed design', prompt: 'What is the proposed design? Format: cover architecture, interfaces/APIs, data model, and key implementation details. Use subheadings (####) for each area. MUST include a ```mermaid diagram showing the proposed architecture/data flow.', draftHeading: 'Proposed design' },
      { key: 'impact', label: 'Impact', prompt: 'What changes from current to proposed? Format: three subsections — "Breaking changes" (what stops working), "Migration path" (step-by-step), and "Rollout plan" (phases/flags/gates). Use bulleted lists.', draftHeading: 'Impact' },
    ],
  },
  {
    kind: 'testing_plan',
    label: 'Testing Plan',
    primaryRoles: ['PM', 'SWE'],
    default: true,
    sections: [
      { key: 'strategy', label: 'Test strategy', prompt: 'What is the testing strategy? Format: table with columns: Layer (unit/integration/e2e) | What is tested | Tool/framework | Coverage target. Then a paragraph on regression strategy.', draftHeading: 'Test strategy' },
    ],
  },
  {
    kind: 'risks',
    label: 'Risks & Mitigations',
    primaryRoles: ['SWE', 'PM'],
    default: true,
    sections: [
      { key: 'risks', label: 'Risks', prompt: 'What risks follow from this approach? Format: table with columns: Risk | Likelihood (High/Med/Low) | Impact (High/Med/Low) | Description.', draftHeading: 'Risks' },
      { key: 'mitigations', label: 'Mitigations', prompt: 'How are the risks mitigated? Format: table with columns: Risk | Mitigation | Owner | Status (planned/in-place).', draftHeading: 'Mitigations' },
    ],
  },
  {
    kind: 'stories_tasks',
    label: 'User Stories & Tasks',
    primaryRoles: ['PM', 'SWE'],
    default: true,
    sections: [
      { key: 'user_stories', label: 'User stories', prompt: 'What are the user stories? Format: for each story use a subheading (#### US-N: title), then "**As a** [role], **I want** [action], **so that** [benefit]". Below each story list acceptance criteria (- [ ] AC-N.M: criterion). Below the AC, list the technical tasks for THIS story (- Task N.M: description [effort: S/M/L]). Each story is self-contained: story → AC → tasks. A story has 1+ AC and 0+ tasks.', draftHeading: 'User stories' },
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
