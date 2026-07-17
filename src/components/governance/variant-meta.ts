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

/** An in-page tab of a variant (e.g. Document → Spec / Audit / Discussion). Each tab is
 *  its own view with its OWN affordances — an affordance applies only to that tab. */
export interface VariantTab {
  id: string;
  label: string;
  affordances?: readonly VariantAffordance[];
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
  { id: 'anatomy', label: 'Anatomy' },
  { id: 'header', label: 'Header' },
];

// The Content Shell's 2 sub-pages: (1) the full dashboard shell, (2) the metric-box
// count variants (3 · 4 · 5) shown together.
export const CONTENT_SHELL_VARIANTS: readonly VariantMeta[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    affordances: [
      { id: 'metrics', label: 'Metrics row', canonicalComponent: 'MetricRow', canonicalFilePath: 'src/components/ui/metric-card.tsx', defaultOn: true },
      { id: 'rail', label: 'Right panel', canonicalComponent: 'feature-rail (RailNote / RailCard)', canonicalFilePath: 'src/components/patterns/feature-rail.tsx', defaultOn: true },
    ],
  },
  { id: 'metricCounts', label: 'Metric counts' },
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
    canonicalFilePath: 'src/components/patterns/list.tsx', // to be created — no shared list component yet
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
    canonicalFilePath: 'src/components/patterns/form-section.tsx', // to be created — no shared form-section component yet
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
    canonicalComponent: 'ProseBlock',
    canonicalFilePath: 'src/components/patterns/prose-block.tsx',
    // Shell chrome (title + version + tab bar + approvers row) is always present; each
    // tab carries only the affordances that apply to it.
    tabs: [
      {
        id: 'spec',
        label: 'Spec',
        affordances: [
          { id: 'approve', label: 'Approve action', canonicalComponent: 'Button', canonicalFilePath: 'src/components/ui/button.tsx', defaultOn: true },
        ],
      },
      {
        id: 'audit',
        label: 'Audit',
        affordances: [
          { id: 'applyBar', label: 'Apply findings bar', canonicalComponent: 'FindingsApplyBar', canonicalFilePath: 'src/components/patterns/findings.tsx', defaultOn: true },
        ],
      },
      {
        id: 'discussion',
        label: 'Discussion',
        affordances: [
          { id: 'composer', label: 'Composer', canonicalComponent: 'ConversationComposer', canonicalFilePath: 'src/components/patterns/conversation.tsx', defaultOn: true },
          { id: 'messageMeta', label: 'Message meta', canonicalComponent: 'renderMeta', canonicalFilePath: 'src/components/patterns/conversation.tsx', defaultOn: false },
        ],
      },
    ],
    consumers: [
      { id: 'plan', label: 'Project › Plan', filePath: 'src/components/forge/PlanStageClient.tsx' },
      { id: 'journal-stage', label: 'Project › Journal', filePath: 'src/components/forge/JournalStageClient.tsx' },
      { id: 'run-detail', label: 'Loops › Activities (run detail)', filePath: 'app/(app)/loops/RunDetail.tsx' },
      { id: 'spec-finalize', label: 'Project › Spec', filePath: 'src/components/forge/SpecStageClient.tsx' },
    ],
  },
  {
    id: 'statCard',
    label: 'Stat card',
    canonicalComponent: 'Card + CardHeader (icon + title) · CardContent stat rows',
    canonicalFilePath: 'src/components/ui/card.tsx',
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
    canonicalComponent: 'button[aria-pressed] tile',
    canonicalFilePath: 'src/components/patterns/list.tsx', // to be created — no shared tile component yet
    affordances: [
      { id: 'icon', label: 'Tile icon (flips to check)', canonicalComponent: 'lucide icon', canonicalFilePath: 'lucide-react', defaultOn: true },
      { id: 'meta', label: 'Meta row', canonicalComponent: 'Badge / chips', canonicalFilePath: 'src/components/ui/badge.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'spec-outline', label: 'Project › Spec › Outline', filePath: 'src/components/forge/SpecStageClient.tsx' },
      { id: 'new-project-preset', label: 'New project (preset picker)', filePath: 'app/(app)/projects/new/NewProjectForm.tsx' },
    ],
  },
  {
    id: 'statusCard',
    label: 'Status card',
    canonicalComponent: 'bordered div, state-driven border',
    canonicalFilePath: 'src/components/patterns/list.tsx', // to be created — no shared status-card component yet
    affordances: [
      { id: 'statusBadge', label: 'Status badge', canonicalComponent: 'Badge', canonicalFilePath: 'src/components/ui/badge.tsx', defaultOn: true },
      { id: 'progress', label: 'Progress bar', canonicalComponent: 'progress bar', canonicalFilePath: 'src/components/forge/ExecuteStageClient.tsx', defaultOn: true },
    ],
    consumers: [
      { id: 'execute-repo', label: 'Project › Execute › Repo cards', filePath: 'src/components/forge/ExecuteStageClient.tsx' },
      { id: 'project-card', label: 'Projects page (project cards)', filePath: 'src/components/forge/ProjectCard.tsx' },
      { id: 'audit-round', label: 'Project › Review › Audit rounds', filePath: 'src/components/patterns/findings.tsx' },
    ],
  },
];
