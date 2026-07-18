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
  /** Known non-conformers for this pattern. Tabbed variants declare these per tab instead. */
  deviations?: readonly VariantConsumer[];
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

// The Right-panel patterns — the section BELOW the rail note (the note is separate). What
// kind of container the below-note section is.
export const RIGHT_PANEL_VARIANTS: readonly VariantMeta[] = [
  {
    id: 'navigator',
    label: 'Navigator',
    canonicalComponent: 'StageNavigator',
    canonicalFilePath: 'src/components/patterns/stage-navigator.tsx',
    affordances: [
      { id: 'headerAction', label: 'Header bulk action', canonicalComponent: 'Button (Approve all / Revoke all)', canonicalFilePath: 'src/components/ui/button.tsx', defaultOn: true },
      { id: 'progress', label: 'Progress bar', canonicalComponent: 'progress bar', canonicalFilePath: 'src/components/patterns/stage-navigator.tsx', defaultOn: true },
      { id: 'sectionHeaders', label: 'Section headers', canonicalComponent: 'Micro (grouped clusters)', canonicalFilePath: 'src/components/ui/typography.tsx', defaultOn: true },
      { id: 'checkTick', label: 'Check tile', canonicalComponent: 'check tile (number → ✓)', canonicalFilePath: 'src/components/patterns/stage-navigator.tsx', defaultOn: true },
      { id: 'itemMeta', label: 'Item meta line', canonicalComponent: 'meta row', canonicalFilePath: 'src/components/patterns/stage-navigator.tsx', defaultOn: true },
      { id: 'advance', label: 'Advance footer', canonicalComponent: 'Button (primary, full-width)', canonicalFilePath: 'src/components/ui/button.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'plan-tasks', label: 'Project › Plan › tasks', filePath: 'src/components/forge/PlanStageClient.tsx' }, // all 6 affordances (the canonical, richest navigator)
      { id: 'spec-components', label: 'Project › Spec › components', filePath: 'src/components/forge/SpecStageClient.tsx' }, // no header bulk action
      { id: 'journal-learnings', label: 'Project › Journal › learnings', filePath: 'src/components/forge/JournalStageClient.tsx' }, // flat (no section headers)
      { id: 'execute-repos', label: 'Project › Execute › repos', filePath: 'src/components/forge/ExecuteStageClient.tsx' }, // no header action / check tiles
    ],
  },
  {
    id: 'railCard',
    label: 'Rail card',
    canonicalComponent: 'RailCard',
    canonicalFilePath: 'src/components/patterns/feature-rail.tsx',
    affordances: [
      { id: 'badge', label: 'Count badge', canonicalComponent: 'Badge', canonicalFilePath: 'src/components/ui/badge.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'projects-attention', label: 'Projects › Needs your attention', filePath: 'app/(app)/projects/page.tsx' },
      { id: 'projects-activity', label: 'Projects › Agent activity', filePath: 'app/(app)/projects/page.tsx' },
    ],
  },
  {
    id: 'cardList',
    label: 'Card list',
    // A generic run/result panel: a header action, a scrollable list of result cards,
    // and a gated advance footer. The audit-run lifecycle is one instance of it.
    canonicalComponent: 'Card — header action + scrollable card list + gated advance footer',
    canonicalFilePath: 'src/components/ui/card.tsx',
    affordances: [
      { id: 'headerAction', label: 'Header action', canonicalComponent: 'Button (run / generate / re-run)', canonicalFilePath: 'src/components/ui/button.tsx', defaultOn: true },
      { id: 'advance', label: 'Advance footer', canonicalComponent: 'StageAdvance (gated, locks the stage)', canonicalFilePath: 'src/components/forge/StageAdvance.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'plan-validate', label: 'Project › Plan › Validate (audit rounds)', filePath: 'src/components/forge/PlanStageClient.tsx' },
      { id: 'review-passes', label: 'Project › Review › passes', filePath: 'src/components/forge/ReviewStageClient.tsx' },
      { id: 'spec-audit', label: 'Project › Spec › Finalize (audit rounds)', filePath: 'src/components/forge/SpecStageClient.tsx' },
    ],
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
      { id: 'header', label: 'Header title', canonicalComponent: 'Title', canonicalFilePath: 'src/components/ui/typography.tsx', defaultOn: true },
      { id: 'primaryAction', label: 'Header action', canonicalComponent: 'Button', canonicalFilePath: 'src/components/ui/button.tsx', defaultOn: true },
      // Search and filter are ONE affordance, never split: a table either carries the full
      // search + filter strip or no toolbar at all. A search-only strip is a deviation.
      { id: 'toolbar', label: 'Search & filter', canonicalComponent: 'Toolbar (+ SearchInput · Select)', canonicalFilePath: 'src/components/ui/toolbar.tsx', defaultOn: true },
      { id: 'rowActions', label: 'Row actions', canonicalComponent: 'DropdownMenu', canonicalFilePath: 'src/components/ui/dropdown-menu.tsx', defaultOn: false },
    ],
    consumers: [
      { id: 'loops', label: 'Loops', filePath: 'app/(app)/loops/LoopsClient.tsx' },
      { id: 'workspace', label: 'Workspace', filePath: 'app/(app)/workspace/WorkspaceClient.tsx' },
      { id: 'members', label: 'Team settings › Members', filePath: 'app/(app)/settings/members/MemberTable.tsx' },
      { id: 'org-teams', label: 'Org settings › Teams', filePath: 'app/(app)/settings/org/TeamsPanel.tsx' },
      { id: 'usage', label: 'Usage › Activity breakdown', filePath: 'app/(app)/usage/UsageBatchTable.tsx' },
      { id: 'usage-projects', label: 'Usage › Project costs', filePath: 'app/(app)/usage/ProjectUsageTable.tsx' },
      { id: 'usage-loops', label: 'Usage › Loop costs', filePath: 'app/(app)/usage/LoopUsageTable.tsx' },
      { id: 'usage-standalone', label: 'Usage › Standalone activity', filePath: 'app/(app)/usage/StandaloneUsageTable.tsx' },
    ],
  },
  {
    id: 'form',
    label: 'Form',
    // The FORM AS A PAGE — a page whose primary column is a form (settings, profile). Forms
    // that open inside a table row are governed under Table (`Inline add / edit form`), and
    // the labelled controls themselves under Primitives › Form control. This slot is only
    // the page-level shell: header, fields, footer.
    //
    // EVERY page form opens in its read view — heading + status + the saved value, with Edit
    // to expand. That is not optional, so `disclosure` is not an affordance: it is how this
    // slot behaves. (Row forms skip it, because the table row itself is the read view.)
    //
    // `inline` is likewise a prop, not an affordance — it is a placement whose meaning lives
    // in the Table's chrome and cannot be shown honestly on this page.
    canonicalComponent: 'FormPanel',
    canonicalFilePath: 'src/components/patterns/form-panel.tsx',
    affordances: [
      { id: 'heading', label: 'Heading', canonicalComponent: 'TextStrong', canonicalFilePath: 'src/components/ui/typography.tsx', defaultOn: true },
      { id: 'indicator', label: 'Status indicator', canonicalComponent: 'Badge', canonicalFilePath: 'src/components/ui/badge.tsx', defaultOn: false },
      { id: 'twoColumn', label: 'Two-column layout', canonicalComponent: 'FieldGrid', canonicalFilePath: 'src/components/ui/field-grid.tsx', defaultOn: true },
      { id: 'avatar', label: 'Avatar colour picker', canonicalComponent: 'AvatarPicker', canonicalFilePath: 'src/components/ui/avatar-picker.tsx', defaultOn: false },
      { id: 'validate', label: 'Validate connection', canonicalComponent: 'VerifyResultBox', canonicalFilePath: 'src/components/forge/VerifyResultBox.tsx', defaultOn: false },
    ],
    consumers: [
      { id: 'connections-mma', label: 'Org settings › Connections › MMA', filePath: 'app/(app)/settings/connections/ConnectionsForm.tsx' },
      { id: 'connections-stt', label: 'Org settings › Connections › Speech-to-text', filePath: 'app/(app)/settings/connections/ConnectionsForm.tsx' },
      { id: 'team-git-token', label: 'Team settings › Git token', filePath: 'app/(app)/settings/team/GitTokenForm.tsx' },
      { id: 'team-workspace', label: 'Team settings › Workspace', filePath: 'app/(app)/settings/team/WorkspaceForm.tsx' },
      { id: 'profile-account', label: 'Profile › Account', filePath: 'app/(app)/profile/ProfileForm.tsx' },
      { id: 'profile-password', label: 'Profile › Password', filePath: 'app/(app)/profile/ProfileForm.tsx' },
    ],
    deviations: [
      { id: 'models-configure', label: 'Org settings › Models (hand-rolled shell + segmented controls)', filePath: 'app/(app)/settings/models/ModelsPanel.tsx' },
      { id: 'new-project', label: 'New project (CardFooter submit, raw radios)', filePath: 'app/(app)/projects/new/NewProjectForm.tsx' },
      { id: 'slot-editor', label: 'Components › Slot editor (auto-save, no submit)', filePath: 'app/(app)/settings/components/SlotEditor.tsx' },
      { id: 'explore-add-task', label: 'Project › Explore › Add task (raw controls)', filePath: 'src/components/forge/ExploreStageClient.tsx' },
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
      { id: 'toolbar', label: 'Search & filter', canonicalComponent: 'Input (search) + role chips', canonicalFilePath: 'src/components/ui/input.tsx', defaultOn: true },
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
