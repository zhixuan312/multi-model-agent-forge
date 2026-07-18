// Shared (NON-'use client') variant metadata — id + label only. Safe to import from
// the registry, which is evaluated on the server (via component-governance-core). The
// actual renders live in the 'use client' preview modules, keyed by these ids, and are
// reached through the AppShellVariant / ContentAreaVariant client components.

export interface VariantConsumer {
  id: string;
  label: string;
  filePath: string;
}

/** A bounded, governed optional piece a consumer may switch ON — and nothing else.
 *  The child composes from this fixed menu; it cannot invent a new affordance. Each
 *  one maps to its own shared component so there's one search box, one filter bar, etc. */
export interface VariantAffordance {
  id: string;
  label: string;
  canonicalComponent: string;
  canonicalFilePath: string;
  defaultOn: boolean;
}

/** An in-page tab of a variant (e.g. Document → Document / Audit / Discussion). Each tab is
 *  its own view with its OWN affordances, consumers and deviations — a tab's section is used
 *  in different places than the others. */
export interface VariantTab {
  id: string;
  label: string;
  affordances?: readonly VariantAffordance[];
  consumers?: readonly VariantConsumer[];
  deviations?: readonly VariantConsumer[];
}

export interface VariantMeta {
  id: string;
  label: string;
  /** Pages/components that use this pattern (filled for Left panel). */
  consumers?: readonly VariantConsumer[];
  /** The shared canonical component every consumer of this pattern extends from.
   *  Prescriptive — names the file to converge on, which may not exist yet. */
  canonicalComponent?: string;
  canonicalFilePath?: string;
  /** The fixed set of optional pieces a consumer may toggle on (search, filters…). */
  affordances?: readonly VariantAffordance[];
  /** In-page tabs; when present the variant page shows a tab bar and affordances scope
   *  per active tab (e.g. Document → Spec / Audit / Discussion). */
  tabs?: readonly VariantTab[];
}

/** Every affordance id for a variant — previews open with ALL affordances turned on. */
export function defaultEnabledAffordances(v: Pick<VariantMeta, 'affordances'>): ReadonlySet<string> {
  return new Set((v.affordances ?? []).map((a) => a.id));
}

export const APP_SHELL_VARIANTS: readonly VariantMeta[] = [
  {
    id: 'anatomy',
    label: 'Anatomy',
    consumers: [
      { id: 'app-layout', label: 'App layout (all authed routes)', filePath: 'app/(app)/layout.tsx' },
      { id: 'project-layout', label: 'Project layout', filePath: 'app/(app)/projects/[id]/layout.tsx' },
    ],
  },
  {
    id: 'header',
    label: 'Header',
    consumers: [
      { id: 'page-frame', label: 'PageFrame (standard pages)', filePath: 'src/components/ui/shell.tsx' },
      { id: 'project-topbar', label: 'Project layout (custom topbar)', filePath: 'app/(app)/projects/[id]/layout.tsx' },
    ],
  },
];

// The Content Shell's 2 sub-pages: (1) the full dashboard shell, (2) the metric-box
// count variants (3 · 4 · 5) shown together.
export const CONTENT_SHELL_VARIANTS: readonly VariantMeta[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    affordances: [
      { id: 'stageFlow', label: 'Stage flow (project only)', canonicalComponent: 'StageStepper', canonicalFilePath: 'src/components/forge/StageStepper.tsx', defaultOn: true },
      { id: 'metrics', label: 'Metrics row', canonicalComponent: 'MetricRow', canonicalFilePath: 'src/components/ui/metric-card.tsx', defaultOn: true },
      { id: 'rail', label: 'Right panel', canonicalComponent: 'feature-rail (RailNote / RailCard)', canonicalFilePath: 'src/components/patterns/feature-rail.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'loops-workspace', label: 'Loops / Workspace', filePath: 'app/(app)/loops/page.tsx' },
      { id: 'journal', label: 'Journal', filePath: 'src/components/forge/journal/journal-shell.tsx' },
      { id: 'stages', label: 'Project stages', filePath: 'src/components/forge/SpecStageClient.tsx' },
    ],
  },
  {
    id: 'metricCounts',
    label: 'Metric counts',
    consumers: [
      { id: 'team-metrics', label: 'Team settings › Team', filePath: 'app/(app)/settings/team/page.tsx' },
      { id: 'usage-metrics', label: 'Usage dashboard', filePath: 'app/(app)/usage/OrgUsageDashboard.tsx' },
      { id: 'journal-metrics', label: 'Journal', filePath: 'app/(app)/journal/page.tsx' },
    ],
  },
];

// The Stage-flow (project-only) control surfaces: the whole flow, the stepper's visual
// states, the advance-button states, and the automation bar.
export const STAGE_FLOW_VARIANTS: readonly VariantMeta[] = [
  {
    id: 'flow',
    label: 'Flow',
    canonicalComponent: 'StageStepper + StageAdvance',
    canonicalFilePath: 'src/components/forge/StageStepper.tsx',
    consumers: [{ id: 'live-stepper', label: 'Live Stage Stepper', filePath: 'src/components/forge/LiveStageStepper.tsx' }],
  },
  {
    id: 'stepper',
    label: 'Stepper',
    canonicalComponent: 'StageStepper',
    canonicalFilePath: 'src/components/forge/StageStepper.tsx',
    consumers: [{ id: 'live-stepper', label: 'Live Stage Stepper', filePath: 'src/components/forge/LiveStageStepper.tsx' }],
  },
  {
    id: 'advance',
    label: 'Advance button',
    canonicalComponent: 'StageAdvance (stage) · Button primary (phase)',
    canonicalFilePath: 'src/components/forge/StageAdvance.tsx',
    consumers: [{ id: 'stage-phase-advances', label: 'Project stage / phase advances', filePath: 'src/components/forge/StageAdvance.tsx' }],
  },
  {
    id: 'automation',
    label: 'Automation bar',
    canonicalComponent: 'AutomationBar',
    canonicalFilePath: 'src/components/forge/AutomationBar.tsx',
    consumers: [{ id: 'automation-bar', label: 'Project stage automation', filePath: 'src/components/forge/AutomationBar.tsx' }],
  },
];

// The Right-panel (rail) layer's kinds — feature-rail.tsx.
export const RIGHT_PANEL_VARIANTS: readonly VariantMeta[] = [
  {
    id: 'railNote',
    label: 'Rail note',
    canonicalComponent: 'RailNote',
    canonicalFilePath: 'src/components/patterns/feature-rail.tsx',
    consumers: [
      { id: 'loops-rail', label: 'Loops / Workspace rail', filePath: 'app/(app)/loops/page.tsx' },
      { id: 'journal-rail', label: 'Journal rail', filePath: 'src/components/forge/journal/JournalNote.tsx' },
      { id: 'stage-rail', label: 'Project › Stage rails', filePath: 'src/components/forge/SpecStageClient.tsx' },
    ],
  },
  {
    id: 'railCard',
    label: 'Rail card',
    canonicalComponent: 'RailCard',
    canonicalFilePath: 'src/components/patterns/feature-rail.tsx',
    consumers: [{ id: 'projects-rail', label: 'Projects page rail', filePath: 'app/(app)/projects/page.tsx' }],
  },
  {
    id: 'railStatus',
    label: 'Rail status',
    canonicalComponent: 'RailStatus',
    canonicalFilePath: 'src/components/patterns/feature-rail.tsx',
    consumers: [], // no adopters yet
  },
];

// The COMMON left-panel patterns — by what kind of container the panel is, not by page.
// What's inside each container (the list rows, table cells, card, etc.) is governed
// separately; the left panel governs only the container shape.
export const LEFT_PANEL_VARIANTS: readonly VariantMeta[] = [
  {
    id: 'list',
    label: 'List',
    canonicalComponent: 'List',
    canonicalFilePath: 'src/components/patterns/list.tsx',
    affordances: [
      { id: 'header', label: 'Section header', canonicalComponent: 'Eyebrow', canonicalFilePath: 'src/components/ui/typography.tsx', defaultOn: true },
      { id: 'expand', label: 'Expand arrow', canonicalComponent: 'ChevronRight', canonicalFilePath: 'lucide-react', defaultOn: true },
      { id: 'leadingIcon', label: 'Row leading icon', canonicalComponent: 'lucide icon', canonicalFilePath: 'lucide-react', defaultOn: true },
      { id: 'trailingMeta', label: 'Row trailing meta', canonicalComponent: 'Badge', canonicalFilePath: 'src/components/ui/badge.tsx', defaultOn: false },
    ],
    consumers: [
      { id: 'journal-recall', label: 'Journal › Recall', filePath: 'src/components/forge/journal/RecallTab.tsx' },
    ],
  },
  {
    id: 'table',
    label: 'Table',
    canonicalComponent: 'DataTable',
    canonicalFilePath: 'src/components/ui/data-table.tsx',
    affordances: [
      { id: 'search', label: 'Search', canonicalComponent: 'Input', canonicalFilePath: 'src/components/ui/input.tsx', defaultOn: true },
      { id: 'filters', label: 'Filters', canonicalComponent: 'Select', canonicalFilePath: 'src/components/ui/select.tsx', defaultOn: true },
      { id: 'rowActions', label: 'Row actions', canonicalComponent: 'DropdownMenu', canonicalFilePath: 'src/components/ui/dropdown-menu.tsx', defaultOn: false },
      { id: 'bulkSelect', label: 'Bulk select', canonicalComponent: 'Checkbox', canonicalFilePath: 'src/components/ui/checkbox.tsx', defaultOn: false },
    ],
    consumers: [
      { id: 'loops', label: 'Loops', filePath: 'app/(app)/loops/LoopsClient.tsx' },
      { id: 'workspace', label: 'Workspace', filePath: 'app/(app)/workspace/WorkspaceClient.tsx' },
      { id: 'members', label: 'Team settings › Members', filePath: 'app/(app)/settings/members/MemberTable.tsx' },
      { id: 'org-teams', label: 'Org settings › Teams', filePath: 'app/(app)/settings/org/TeamsPanel.tsx' },
      { id: 'usage', label: 'Usage › Activity breakdown', filePath: 'app/(app)/usage/UsageBatchTable.tsx' },
    ],
  },
  {
    id: 'form',
    label: 'Form',
    canonicalComponent: 'FormSection',
    canonicalFilePath: 'src/components/patterns/form-section.tsx',
    affordances: [
      { id: 'description', label: 'Section description', canonicalComponent: 'Section text', canonicalFilePath: 'src/components/patterns/form-section.tsx', defaultOn: true },
      { id: 'twoColumn', label: 'Two-column layout', canonicalComponent: 'FieldGrid', canonicalFilePath: 'src/components/ui/field-grid.tsx', defaultOn: true },
      { id: 'footerActions', label: 'Footer actions', canonicalComponent: 'Button', canonicalFilePath: 'src/components/ui/button.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'profile', label: 'Profile', filePath: 'app/(app)/profile/ProfileForm.tsx' },
      { id: 'team-settings', label: 'Team settings › Team', filePath: 'app/(app)/settings/team/page.tsx' },
      { id: 'models', label: 'Org settings › Models', filePath: 'app/(app)/settings/models/ModelsPanel.tsx' },
      { id: 'connections', label: 'Org settings › Connections', filePath: 'app/(app)/settings/connections/ConnectionsForm.tsx' },
      { id: 'new-project', label: 'New project', filePath: 'app/(app)/projects/new/NewProjectForm.tsx' },
      { id: 'explore-brief', label: 'Project › Explore › Brief', filePath: 'src/components/forge/ExploreStageClient.tsx' },
    ],
  },
  {
    id: 'document',
    label: 'Document',
    canonicalComponent: 'DocumentShell',
    canonicalFilePath: 'src/components/patterns/document-shell.tsx',
    // Shell chrome (title + version + tab bar + approvers row) is always present; each
    // tab carries only the affordances that apply to it.
    tabs: [
      {
        id: 'document',
        label: 'Document',
        affordances: [
          { id: 'approvers', label: 'Approvers row', canonicalComponent: 'ParticipantStrip', canonicalFilePath: 'src/components/forge/collab/Participants.tsx', defaultOn: true },
          { id: 'action', label: 'Action (approve / revoke)', canonicalComponent: 'Button', canonicalFilePath: 'src/components/ui/button.tsx', defaultOn: true },
        ],
        consumers: [
          { id: 'spec-finalize', label: 'Project › Spec › Finalize', filePath: 'src/components/forge/SpecStageClient.tsx' },
          { id: 'plan-refine', label: 'Project › Plan › Refine', filePath: 'src/components/forge/PlanStageClient.tsx' },
          { id: 'journal-reflect', label: 'Project › Journal › Reflect', filePath: 'src/components/forge/JournalStageClient.tsx' },
        ],
        deviations: [
          { id: 'run-detail', label: 'Loops › Activities › Run detail (no shell chrome)', filePath: 'app/(app)/loops/RunDetail.tsx' },
        ],
      },
      {
        id: 'audit',
        label: 'Audit',
        affordances: [
          { id: 'approvers', label: 'Approvers row', canonicalComponent: 'ParticipantStrip', canonicalFilePath: 'src/components/forge/collab/Participants.tsx', defaultOn: true },
          { id: 'multiSelect', label: 'Multiple select', canonicalComponent: 'FindingsGrid (selectable)', canonicalFilePath: 'src/components/patterns/findings.tsx', defaultOn: true },
          { id: 'applyBar', label: 'Apply findings bar', canonicalComponent: 'FindingsApplyBar', canonicalFilePath: 'src/components/patterns/findings.tsx', defaultOn: true },
        ],
        consumers: [
          { id: 'spec-audit', label: 'Project › Spec › Finalize', filePath: 'src/components/forge/SpecStageClient.tsx' },
          { id: 'plan-validate', label: 'Project › Plan › Validate', filePath: 'src/components/forge/PlanStageClient.tsx' },
          { id: 'review', label: 'Project › Review', filePath: 'src/components/forge/ReviewStageClient.tsx' },
        ],
        deviations: [
          { id: 'audit-round-card', label: 'Review › audit-round cards (bespoke button)', filePath: 'src/components/patterns/findings.tsx' },
        ],
      },
      {
        id: 'discussion',
        label: 'Discussion',
        affordances: [
          { id: 'thread', label: 'Discussion thread', canonicalComponent: 'DiscussionThread', canonicalFilePath: 'src/components/forge/collab/DiscussionThread.tsx', defaultOn: true },
          { id: 'composer', label: 'Composer', canonicalComponent: 'ConversationComposer', canonicalFilePath: 'src/components/patterns/conversation.tsx', defaultOn: true },
        ],
        consumers: [
          { id: 'spec-craft', label: 'Project › Spec › Craft', filePath: 'src/components/forge/SpecStageClient.tsx' },
          { id: 'plan-discussion', label: 'Project › Plan › Refine', filePath: 'src/components/forge/PlanStageClient.tsx' },
          { id: 'journal-discussion', label: 'Project › Journal › Reflect', filePath: 'src/components/forge/JournalStageClient.tsx' },
        ],
      },
    ],
  },
  {
    id: 'statCard',
    label: 'Stat card',
    canonicalComponent: 'StatCard',
    canonicalFilePath: 'src/components/patterns/cards.tsx',
    affordances: [
      { id: 'icon', label: 'Header icon', canonicalComponent: 'lucide icon', canonicalFilePath: 'lucide-react', defaultOn: true },
      { id: 'footer', label: 'Card footer', canonicalComponent: 'CardFooter', canonicalFilePath: 'src/components/ui/card.tsx', defaultOn: false },
    ],
    consumers: [
      { id: 'journal-summary', label: 'Project › Journal › Summary', filePath: 'src/components/forge/SummaryPhase.tsx' },
      { id: 'execute-summary', label: 'Project › Execute › Summary', filePath: 'src/components/forge/ExecuteStageClient.tsx' },
    ],
  },
  {
    id: 'selectableTile',
    label: 'Selectable tile',
    canonicalComponent: 'SelectableTile',
    canonicalFilePath: 'src/components/patterns/cards.tsx',
    affordances: [
      { id: 'icon', label: 'Tile icon (flips to check)', canonicalComponent: 'lucide icon', canonicalFilePath: 'lucide-react', defaultOn: true },
      { id: 'meta', label: 'Meta row', canonicalComponent: 'Badge / chips', canonicalFilePath: 'src/components/ui/badge.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'spec-outline', label: 'Project › Spec › Outline', filePath: 'src/components/forge/SpecStageClient.tsx' },
      { id: 'new-project-preset', label: 'New project › Preset picker', filePath: 'app/(app)/projects/new/NewProjectForm.tsx' },
    ],
  },
  {
    id: 'statusCard',
    label: 'Status card',
    canonicalComponent: 'StatusCard',
    canonicalFilePath: 'src/components/patterns/cards.tsx',
    affordances: [
      { id: 'statusBadge', label: 'Status badge', canonicalComponent: 'Badge', canonicalFilePath: 'src/components/ui/badge.tsx', defaultOn: true },
      { id: 'progress', label: 'Progress bar', canonicalComponent: 'progress bar', canonicalFilePath: 'src/components/forge/ExecuteStageClient.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'execute-repo', label: 'Project › Execute › Repo cards', filePath: 'src/components/forge/ExecuteStageClient.tsx' },
      { id: 'project-card', label: 'Projects › Project cards', filePath: 'src/components/forge/ProjectCard.tsx' },
      { id: 'audit-round', label: 'Project › Review › Audit rounds', filePath: 'src/components/patterns/findings.tsx' },
    ],
  },
];
