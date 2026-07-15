import type { ReactNode } from 'react';
import { Cpu, LayoutPanelTop, PanelsTopLeft, Route, Shield, Sparkles } from 'lucide-react';
import { Badge, EmptyState, MetricCard, PageHeader, PageFrame, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { Sidebar } from '@/components/forge/Sidebar';
import { StageStepper } from '@/components/forge/StageStepper';
import { StageFullWidth, StageShell, type StageShellItem } from '@/components/patterns/stage-shell';
import { AuthPlainBackgroundShell } from '@/components/governance/AuthPlainBackgroundShell';

export type GovernanceSlotGroup = 'structural' | 'leaf';

export type GovernanceSlotId =
  | 'plainBackground'
  | 'stageFlow'
  | 'sidebar'
  | 'stageLayout'
  | 'pageShell'
  | 'authPlainBackground'
  | 'pageHeader'
  | 'badge'
  | 'emptyState'
  | 'metricCard'
  | 'tabs';

export type GovernanceKnobType = 'boolean' | 'enum';

export interface GovernanceKnobDefinition {
  name: string;
  type: GovernanceKnobType;
  allowedValues: readonly (string | boolean)[];
  defaultValue: string | boolean;
}

export interface GovernanceDeviation {
  id: string;
  label: string;
  filePath: string;
  line: number | null;
}

export interface GovernanceConsumer {
  id: string;
  label: string;
  filePath: string;
}

export type GovernanceKnobValues = Record<string, string | boolean>;

export interface PersistedGovernanceSlotState {
  locked: boolean;
  knobs: GovernanceKnobValues;
}

export interface ResolvedGovernanceSlotState {
  slotId: GovernanceSlotId;
  locked: boolean;
  knobs: GovernanceKnobValues;
}

// Client-safe shared view types. These live here (not in the server-only
// component-governance-core, which imports `@/db/client`) so that `'use client'`
// components can import them WITHOUT pulling in the DB client. The server core
// re-exports them for its own callers.
export interface GovernanceSlotView {
  slotId: GovernanceSlotId;
  label: string;
  group: GovernanceSlotGroup;
  canonicalComponent: string;
  canonicalFilePath: string;
  knobSchema: readonly GovernanceKnobDefinition[];
  consumers: readonly GovernanceConsumer[];
  deviations: readonly GovernanceDeviation[];
  locked: boolean;
  knobs: GovernanceKnobValues;
}

export interface ComponentGovernanceView {
  slots: GovernanceSlotView[];
}

export interface GovernanceRegistryEntry {
  slotId: GovernanceSlotId;
  label: string;
  group: GovernanceSlotGroup;
  canonicalComponent: string;
  canonicalFilePath: string;
  knobs: readonly GovernanceKnobDefinition[];
  defaultLocked: boolean;
  consumers: readonly GovernanceConsumer[];
  deviations: readonly GovernanceDeviation[];
  renderPreview: (state: ResolvedGovernanceSlotState) => ReactNode;
}

const SAMPLE_STAGE_ITEMS: StageShellItem[] = [
  { id: 'brief', label: 'Brief', description: 'Problem framing', status: 'ready', statusVariant: 'sage' },
  { id: 'plan', label: 'Plan', description: 'Execution order', status: 'active', statusVariant: 'amber' },
];

const SAMPLE_MEMBER = {
  id: 'member-1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  avatarTint: '#9a6b4f',
  role: 'org_admin' as const,
  teamId: null,
};

export const GOVERNANCE_KNOBS: Record<GovernanceSlotId, readonly GovernanceKnobDefinition[]> = {
  plainBackground: [],
  stageFlow: [
    { name: 'condensed', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  sidebar: [
    { name: 'forceVisible', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  stageLayout: [
    { name: 'mode', type: 'enum', allowedValues: ['shell', 'fullWidth'], defaultValue: 'shell' },
    { name: 'showNote', type: 'boolean', allowedValues: [true, false], defaultValue: true },
    { name: 'showSidebar', type: 'boolean', allowedValues: [true, false], defaultValue: true },
  ],
  pageShell: [
    { name: 'width', type: 'enum', allowedValues: ['default', 'wide', 'full'], defaultValue: 'default' },
    { name: 'fill', type: 'boolean', allowedValues: [true, false], defaultValue: false },
    { name: 'showDescription', type: 'boolean', allowedValues: [true, false], defaultValue: true },
  ],
  authPlainBackground: [],
  pageHeader: [
    { name: 'showEyebrow', type: 'boolean', allowedValues: [true, false], defaultValue: true },
    { name: 'showDescription', type: 'boolean', allowedValues: [true, false], defaultValue: true },
    { name: 'showActions', type: 'boolean', allowedValues: [true, false], defaultValue: true },
  ],
  badge: [
    { name: 'variant', type: 'enum', allowedValues: ['neutral', 'accent', 'sage', 'amber', 'rose', 'steel'], defaultValue: 'neutral' },
    { name: 'size', type: 'enum', allowedValues: ['sm', 'md'], defaultValue: 'md' },
    { name: 'dot', type: 'boolean', allowedValues: [true, false], defaultValue: false },
    { name: 'icon', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  emptyState: [
    { name: 'showDescription', type: 'boolean', allowedValues: [true, false], defaultValue: true },
    { name: 'showAction', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  metricCard: [
    { name: 'tone', type: 'enum', allowedValues: ['neutral', 'attention'], defaultValue: 'neutral' },
    { name: 'iconTint', type: 'enum', allowedValues: ['accent', 'rose', 'sage', 'steel', 'amber', 'neutral'], defaultValue: 'neutral' },
    { name: 'muted', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  tabs: [
    { name: 'showIcons', type: 'boolean', allowedValues: [true, false], defaultValue: true },
  ],
};

function bool(state: ResolvedGovernanceSlotState, name: string): boolean {
  return Boolean(state.knobs[name]);
}

function text(state: ResolvedGovernanceSlotState, name: string): string {
  return String(state.knobs[name]);
}

export const GOVERNANCE_REGISTRY: Record<GovernanceSlotId, GovernanceRegistryEntry> = {
  plainBackground: {
    slotId: 'plainBackground',
    label: 'Plain background',
    group: 'structural',
    canonicalComponent: 'AppShell background',
    canonicalFilePath: 'src/components/ui/shell.tsx',
    knobs: GOVERNANCE_KNOBS.plainBackground,
    defaultLocked: true,
    consumers: [{ id: 'app-shell', label: 'App Shell', filePath: 'src/components/ui/shell.tsx' }],
    deviations: [],
    renderPreview: () => <div className="rounded-md bg-bg p-4 text-sm text-ink">bg-bg application background</div>,
  },
  stageFlow: {
    slotId: 'stageFlow',
    label: 'Stage flow',
    group: 'structural',
    canonicalComponent: 'StageStepper',
    canonicalFilePath: 'src/components/forge/StageStepper.tsx',
    knobs: GOVERNANCE_KNOBS.stageFlow,
    defaultLocked: true,
    consumers: [{ id: 'live-stage-stepper', label: 'Live Stage Stepper', filePath: 'src/components/forge/LiveStageStepper.tsx' }],
    deviations: [],
    renderPreview: (state) => (
      <StageStepper
        projectId="preview-project"
        stages={[
          { kind: 'exploration', status: 'done' },
          { kind: 'spec', status: 'active' },
          { kind: 'plan', status: 'pending' },
          { kind: 'execute', status: 'pending' },
          { kind: 'review', status: 'pending' },
          { kind: 'journal', status: 'pending' },
        ]}
        currentStage="spec"
        phase="design"
        condensed={bool(state, 'condensed')}
      />
    ),
  },
  sidebar: {
    slotId: 'sidebar',
    label: 'Sidebar',
    group: 'structural',
    canonicalComponent: 'Sidebar',
    canonicalFilePath: 'src/components/forge/Sidebar.tsx',
    knobs: GOVERNANCE_KNOBS.sidebar,
    defaultLocked: true,
    consumers: [{ id: 'app-layout', label: 'App Layout', filePath: 'app/(app)/layout.tsx' }],
    deviations: [],
    renderPreview: (state) => <Sidebar member={SAMPLE_MEMBER} forceVisible={bool(state, 'forceVisible')} />,
  },
  stageLayout: {
    slotId: 'stageLayout',
    label: 'Stage layout',
    group: 'structural',
    canonicalComponent: 'StageShell / StageFullWidth',
    canonicalFilePath: 'src/components/patterns/stage-shell.tsx',
    knobs: GOVERNANCE_KNOBS.stageLayout,
    defaultLocked: true,
    consumers: [{ id: 'explore-stage', label: 'Explore Stage Client', filePath: 'src/components/forge/ExploreStageClient.tsx' }],
    deviations: [
      { id: 'spec-stage', label: 'SpecStageClient', filePath: 'src/components/forge/SpecStageClient.tsx', line: 535 },
      { id: 'plan-stage', label: 'PlanStageClient', filePath: 'src/components/forge/PlanStageClient.tsx', line: 540 },
      { id: 'execute-stage', label: 'ExecuteStageClient', filePath: 'src/components/forge/ExecuteStageClient.tsx', line: 272 },
      { id: 'review-stage', label: 'ReviewStageClient', filePath: 'src/components/forge/ReviewStageClient.tsx', line: 143 },
      { id: 'journal-stage', label: 'JournalStageClient', filePath: 'src/components/forge/JournalStageClient.tsx', line: 300 },
      { id: 'summary-phase', label: 'SummaryPhase', filePath: 'src/components/forge/SummaryPhase.tsx', line: 134 },
      { id: 'automation-overlay', label: 'AutomationOverlay', filePath: 'src/components/forge/AutomationOverlay.tsx', line: 333 },
      { id: 'new-project-page', label: 'New project page', filePath: 'app/(app)/projects/new/page.tsx', line: 44 },
    ],
    renderPreview: (state) =>
      text(state, 'mode') === 'fullWidth' ? (
        <StageFullWidth
          note={bool(state, 'showNote') ? <div>Guidance note</div> : undefined}
          sidebar={bool(state, 'showSidebar') ? <div>Sidebar content</div> : undefined}
        >
          <div>Main content</div>
        </StageFullWidth>
      ) : (
        <StageShell
          note={bool(state, 'showNote') ? <div>Guidance note</div> : undefined}
          items={SAMPLE_STAGE_ITEMS}
          activeId="plan"
          onSelect={() => {}}
          listTitle="Tasks"
          footer={bool(state, 'showSidebar') ? <button type="button">Continue</button> : undefined}
        >
          <div>Main content</div>
        </StageShell>
      ),
  },
  pageShell: {
    slotId: 'pageShell',
    label: 'Page shell',
    group: 'structural',
    canonicalComponent: 'PageFrame',
    canonicalFilePath: 'src/components/ui/shell.tsx',
    knobs: GOVERNANCE_KNOBS.pageShell,
    defaultLocked: true,
    consumers: [{ id: 'workspace-page', label: 'Workspace page', filePath: 'app/(app)/workspace/page.tsx' }],
    deviations: [],
    renderPreview: (state) => (
      <div className="rounded-md border border-line">
        <PageFrame
          title="Governed page"
          description={bool(state, 'showDescription') ? 'Standard page framing preview.' : undefined}
          width={text(state, 'width') as 'default' | 'wide' | 'full'}
          fill={bool(state, 'fill')}
        >
          <div>Page body</div>
        </PageFrame>
      </div>
    ),
  },
  authPlainBackground: {
    slotId: 'authPlainBackground',
    label: 'Auth plain background',
    group: 'structural',
    canonicalComponent: 'AuthPlainBackgroundShell',
    canonicalFilePath: 'src/components/governance/AuthPlainBackgroundShell.tsx',
    knobs: GOVERNANCE_KNOBS.authPlainBackground,
    defaultLocked: true,
    consumers: [
      { id: 'login', label: 'Login Form', filePath: 'app/(auth)/login/LoginForm.tsx' },
      { id: 'setup', label: 'Setup Form', filePath: 'app/(auth)/setup/SetupForm.tsx' },
    ],
    deviations: [],
    renderPreview: () => <AuthPlainBackgroundShell><div className="rounded-md border border-line bg-surface p-4">Auth card</div></AuthPlainBackgroundShell>,
  },
  pageHeader: {
    slotId: 'pageHeader',
    label: 'Page header',
    group: 'leaf',
    canonicalComponent: 'PageHeader',
    canonicalFilePath: 'src/components/ui/page-header.tsx',
    knobs: GOVERNANCE_KNOBS.pageHeader,
    defaultLocked: true,
    consumers: [],
    deviations: [{ id: 'forge-page-header', label: 'Forge PageHeader', filePath: 'src/components/forge/PageHeader.tsx', line: null }],
    renderPreview: (state) => (
      <PageHeader
        eyebrow={bool(state, 'showEyebrow') ? 'Governed' : undefined}
        title="Projects"
        description={bool(state, 'showDescription') ? 'Canonical page-header primitive.' : undefined}
        actions={bool(state, 'showActions') ? <button type="button">Action</button> : undefined}
      />
    ),
  },
  badge: {
    slotId: 'badge',
    label: 'Badge',
    group: 'leaf',
    canonicalComponent: 'Badge',
    canonicalFilePath: 'src/components/ui/badge.tsx',
    knobs: GOVERNANCE_KNOBS.badge,
    defaultLocked: true,
    consumers: [],
    deviations: [
      { id: 'severity-badge', label: 'SeverityBadge', filePath: 'src/components/patterns/findings.tsx', line: null },
      { id: 'journal-status-badge', label: 'Journal StatusBadge', filePath: 'src/components/forge/journal/StatusBadge.tsx', line: null },
      { id: 'writelog-pills', label: 'WriteLog operation pills', filePath: 'src/components/forge/journal/WriteLogView.tsx', line: null },
    ],
    renderPreview: (state) => (
      <Badge
        variant={text(state, 'variant') as 'neutral' | 'accent' | 'sage' | 'amber' | 'rose' | 'steel'}
        size={text(state, 'size') as 'sm' | 'md'}
        dot={bool(state, 'dot')}
        icon={bool(state, 'icon') ? <Sparkles className="size-3" /> : undefined}
      >
        Governed
      </Badge>
    ),
  },
  emptyState: {
    slotId: 'emptyState',
    label: 'Empty state',
    group: 'leaf',
    canonicalComponent: 'EmptyState',
    canonicalFilePath: 'src/components/ui/empty-state.tsx',
    knobs: GOVERNANCE_KNOBS.emptyState,
    defaultLocked: true,
    consumers: [{ id: 'projects-page', label: 'Projects page', filePath: 'app/(app)/projects/page.tsx' }],
    deviations: [{ id: 'forge-empty-state', label: 'Forge PageHeader helper', filePath: 'src/components/forge/PageHeader.tsx', line: null }],
    renderPreview: (state) => (
      <EmptyState
        icon={<Cpu />}
        title="No components yet"
        description={bool(state, 'showDescription') ? 'Canonical empty-state preview.' : undefined}
        action={bool(state, 'showAction') ? <button type="button">Create</button> : undefined}
      />
    ),
  },
  metricCard: {
    slotId: 'metricCard',
    label: 'Metric card',
    group: 'leaf',
    canonicalComponent: 'MetricCard',
    canonicalFilePath: 'src/components/ui/metric-card.tsx',
    knobs: GOVERNANCE_KNOBS.metricCard,
    defaultLocked: true,
    consumers: [{ id: 'models-page', label: 'Models page', filePath: 'app/(app)/settings/models/page.tsx' }],
    deviations: [
      { id: 'summary-phase-cards', label: 'SummaryPhase cards', filePath: 'src/components/forge/SummaryPhase.tsx', line: null },
      { id: 'build-monitor-cards', label: 'BuildMonitor cards', filePath: 'src/components/forge/BuildMonitor.tsx', line: null },
    ],
    renderPreview: (state) => (
      <MetricCard
        label="Jobs"
        value="12"
        icon={<Shield />}
        tone={text(state, 'tone') as 'neutral' | 'attention'}
        iconTint={text(state, 'iconTint') as 'accent' | 'rose' | 'sage' | 'steel' | 'amber' | 'neutral'}
        muted={bool(state, 'muted')}
        sublabel="Governed metric"
      />
    ),
  },
  tabs: {
    slotId: 'tabs',
    label: 'Tabs',
    group: 'leaf',
    canonicalComponent: 'Tabs',
    canonicalFilePath: 'src/components/ui/tabs.tsx',
    knobs: GOVERNANCE_KNOBS.tabs,
    defaultLocked: true,
    consumers: [],
    deviations: [
      { id: 'org-settings-tabs', label: 'OrgSettingsTabs', filePath: 'src/components/forge/OrgSettingsTabs.tsx', line: null },
      { id: 'team-settings-tabs', label: 'TeamSettingsTabs', filePath: 'src/components/forge/TeamSettingsTabs.tsx', line: null },
    ],
    renderPreview: (state) => (
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            {bool(state, 'showIcons') ? <LayoutPanelTop className="size-4" /> : null}
            Overview
          </TabsTrigger>
          <TabsTrigger value="details">
            {bool(state, 'showIcons') ? <PanelsTopLeft className="size-4" /> : null}
            Details
          </TabsTrigger>
          <TabsTrigger value="routing">
            {bool(state, 'showIcons') ? <Route className="size-4" /> : null}
            Routing
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview panel</TabsContent>
        <TabsContent value="details">Details panel</TabsContent>
        <TabsContent value="routing">Routing panel</TabsContent>
      </Tabs>
    ),
  },
};
