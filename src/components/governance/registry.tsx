import type { ReactNode } from 'react';
import { Cpu, Shield, Sparkles } from 'lucide-react';
import { Avatar, AvatarGroup, Badge, Banner, Button, EmptyState, Field, Input, MetricCard } from '@/components/ui';
import { AppShellPreview, AppShellVariant } from '@/components/governance/AppShellPreview';
import { ContentAreaPreview, ContentAreaVariant } from '@/components/governance/ContentAreaPreview';
import { LeftPanelPreview, LeftPanelVariant } from '@/components/governance/LeftPanelPreview';
import { RightPanelPreview, RightPanelVariant } from '@/components/governance/RightPanelPreview';
import { APP_SHELL_VARIANTS, CONTENT_SHELL_VARIANTS, LEFT_PANEL_VARIANTS, RIGHT_PANEL_VARIANTS, STAGE_FLOW_VARIANTS, type VariantAffordance, type VariantTab } from '@/components/governance/variant-meta';
import { StageFlowPreview, StageFlowVariant } from '@/components/governance/StageFlowPreview';
import { showToast } from '@/components/ui/toast';

// The governance model is a LAYER STACK. `structural` layers stack bottom→top to form a
// page; `project` is the project-only SDLC machinery; `primitive` are the shared atoms.
export type GovernanceSlotGroup = 'structural' | 'project' | 'primitive';

export type GovernanceSlotId =
  // structural layers, bottom → top
  | 'background'
  | 'appShell'
  | 'contentShell'
  | 'leftPanel'
  | 'rightPanel'
  // project-only
  | 'stageFlow'
  // shared primitives
  | 'button'
  | 'badge'
  | 'formControl'
  | 'metricCard'
  | 'emptyState'
  | 'banner'
  | 'avatar'
  | 'toast';

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

/** A sub-page of a slot — the 3rd sidebar layer. Present only on slots that have
 *  distinct variants (e.g. App shell's header layouts, Content area's page layouts). */
export interface GovernanceVariant {
  id: string;
  label: string;
  /** `enabled` is the set of affordance ids switched on; `activeTab` is the selected
   *  in-page tab (for tabbed variants like Document). */
  renderPreview: (enabled?: ReadonlySet<string>, activeTab?: string) => ReactNode;
  consumers?: readonly GovernanceConsumer[];
  /** The shared canonical component this pattern's consumers extend from. */
  canonicalComponent?: string;
  canonicalFilePath?: string;
  /** The fixed menu of optional pieces a consumer may toggle on. */
  affordances?: readonly VariantAffordance[];
  /** In-page tabs; affordances scope per active tab. */
  tabs?: readonly VariantTab[];
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
  /** Optional sub-pages; when present the slot expands to a 3rd nav layer. */
  variants?: readonly GovernanceVariant[];
}



export const GOVERNANCE_KNOBS: Record<GovernanceSlotId, readonly GovernanceKnobDefinition[]> = {
  background: [],
  appShell: [],
  contentShell: [],
  leftPanel: [],
  rightPanel: [],
  stageFlow: [],
  button: [],
  badge: [
    { name: 'variant', type: 'enum', allowedValues: ['neutral', 'accent', 'sage', 'amber', 'rose', 'steel'], defaultValue: 'neutral' },
    { name: 'size', type: 'enum', allowedValues: ['sm', 'md'], defaultValue: 'md' },
    { name: 'dot', type: 'boolean', allowedValues: [true, false], defaultValue: false },
    { name: 'icon', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  formControl: [],
  metricCard: [
    { name: 'tone', type: 'enum', allowedValues: ['neutral', 'attention'], defaultValue: 'neutral' },
    { name: 'iconTint', type: 'enum', allowedValues: ['accent', 'rose', 'sage', 'steel', 'amber', 'neutral'], defaultValue: 'neutral' },
    { name: 'muted', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  emptyState: [
    { name: 'showDescription', type: 'boolean', allowedValues: [true, false], defaultValue: true },
    { name: 'showAction', type: 'boolean', allowedValues: [true, false], defaultValue: false },
  ],
  banner: [],
  avatar: [],
  toast: [],
};

function bool(state: ResolvedGovernanceSlotState, name: string): boolean {
  return Boolean(state.knobs[name]);
}

function text(state: ResolvedGovernanceSlotState, name: string): string {
  return String(state.knobs[name]);
}

export const GOVERNANCE_REGISTRY: Record<GovernanceSlotId, GovernanceRegistryEntry> = {
  background: {
    slotId: 'background',
    label: 'Background',
    group: 'structural',
    // The application background is NOT a flat fill — it is the `--bg` token base
    // PLUS a faint warm accent bloom, applied via the single `.app-bg` class.
    canonicalComponent: 'Application background — .app-bg (var(--bg) + accent bloom)',
    canonicalFilePath: 'app/globals.css',
    knobs: GOVERNANCE_KNOBS.background,
    defaultLocked: true,
    consumers: [
      { id: 'app-shell', label: 'App Shell (all authed routes)', filePath: 'src/components/ui/shell.tsx' },
      { id: 'auth-shell', label: 'Auth shell (login / setup)', filePath: 'src/components/governance/AuthPlainBackgroundShell.tsx' },
    ],
    deviations: [],
    // Reuse the canonical `.app-bg` class itself so the preview can NEVER drift
    // from the real background (single source of truth — no parallel gradient).
    // The only override is `background-attachment: fixed → scroll`, so the
    // viewport-anchored bloom instead scales to the swatch box at preview size.
    renderPreview: () => (
      <div
        className="app-bg rounded-md border border-line p-4 text-sm text-ink"
        style={{ backgroundAttachment: 'scroll' }}
      >
        Application background — <code className="text-ink-soft">var(--bg)</code> base + warm accent bloom
      </div>
    ),
  },
  appShell: {
    slotId: 'appShell',
    label: 'App shell',
    group: 'structural',
    canonicalComponent: 'AppShell',
    canonicalFilePath: 'src/components/ui/shell.tsx',
    knobs: GOVERNANCE_KNOBS.appShell,
    defaultLocked: true,
    // Verified across every authed screen: all render their frame through these
    // primitives, so the consumers below are the three sanctioned entry points.
    consumers: [
      { id: 'app-layout', label: 'App Layout — mounts AppShell (sidebar + header + top-right cluster)', filePath: 'app/(app)/layout.tsx' },
      { id: 'page-frame', label: 'PageFrame — standard screen wrapper (settings · usage · loops · journal · projects list · profile · styleguide)', filePath: 'src/components/ui/shell.tsx' },
      { id: 'project-layout', label: 'Project layout — direct ShellHeader/ShellSubNav/ShellBody composition (custom topbar + stage stepper)', filePath: 'app/(app)/projects/[id]/layout.tsx' },
    ],
    deviations: [],
    // AppShell (sidebar + header bar + body). The preview shows the shell anatomy plus
    // every header layout scenario, so the header's arrangement is what's standardized.
    renderPreview: () => <AppShellPreview />,
    variants: APP_SHELL_VARIANTS.map((v) => ({ id: v.id, label: v.label, consumers: v.consumers ?? [], renderPreview: () => <AppShellVariant id={v.id} /> })),
  },
  contentShell: {
    slotId: 'contentShell',
    label: 'Content Shell',
    group: 'structural',
    canonicalComponent: 'StatusDashboard (metrics row + 2/3 + 1/3 rail)',
    canonicalFilePath: 'src/components/patterns/status-dashboard.tsx',
    knobs: GOVERNANCE_KNOBS.contentShell,
    defaultLocked: true,
    consumers: [
      { id: 'loops-page', label: 'Loops / Workspace', filePath: 'app/(app)/loops/page.tsx' },
      { id: 'journal-page', label: 'Journal', filePath: 'src/components/forge/journal/journal-shell.tsx' },
      { id: 'stage-pages', label: 'Project stages', filePath: 'src/components/forge/SpecStageClient.tsx' },
    ],
    deviations: [],
    // The standardized shell: metrics bars on top, then 2/3 work surface + 1/3 rail. Two
    // sub-pages — the Dashboard shell, and the metric-box count variants (3 · 4 · 5).
    renderPreview: () => <ContentAreaPreview />,
    variants: CONTENT_SHELL_VARIANTS.map((v) => ({
      id: v.id,
      label: v.label,
      consumers: v.consumers ?? [],
      affordances: v.affordances,
      renderPreview: (enabled?: ReadonlySet<string>) => <ContentAreaVariant id={v.id} enabled={enabled} />,
    })),
  },
  leftPanel: {
    slotId: 'leftPanel',
    label: 'Left panel',
    group: 'structural',
    // A family of container patterns (list/table/form/…), not one component — the
    // canonical is declared per variant. This slot-level pair is just the family root.
    canonicalComponent: 'Left panel — pattern family',
    canonicalFilePath: 'src/components/governance/variant-meta.ts',
    knobs: GOVERNANCE_KNOBS.leftPanel,
    defaultLocked: true,
    consumers: [],
    deviations: [],
    renderPreview: () => <LeftPanelPreview />,
    variants: LEFT_PANEL_VARIANTS.map((v) => ({
      id: v.id,
      label: v.label,
      consumers: v.consumers ?? [],
      canonicalComponent: v.canonicalComponent,
      canonicalFilePath: v.canonicalFilePath,
      affordances: v.affordances,
      tabs: v.tabs,
      renderPreview: (enabled?: ReadonlySet<string>, activeTab?: string) => <LeftPanelVariant id={v.id} enabled={enabled} activeTab={activeTab} />,
    })),
  },
  rightPanel: {
    slotId: 'rightPanel',
    label: 'Right panel',
    group: 'structural',
    canonicalComponent: 'feature-rail (RailNote / RailCard / RailStatus)',
    canonicalFilePath: 'src/components/patterns/feature-rail.tsx',
    knobs: GOVERNANCE_KNOBS.rightPanel,
    defaultLocked: true,
    consumers: [
      { id: 'stage-rail', label: 'Project stage rails', filePath: 'src/components/forge/SpecStageClient.tsx' },
      { id: 'journal-rail', label: 'Journal rail', filePath: 'src/components/forge/journal/RecallTab.tsx' },
      { id: 'settings-rail', label: 'Settings / profile rail', filePath: 'app/(app)/profile/ProfileForm.tsx' },
    ],
    deviations: [],
    renderPreview: () => <RightPanelPreview />,
    variants: RIGHT_PANEL_VARIANTS.map((v) => ({
      id: v.id,
      label: v.label,
      consumers: v.consumers ?? [],
      canonicalComponent: v.canonicalComponent,
      canonicalFilePath: v.canonicalFilePath,
      renderPreview: () => <RightPanelVariant id={v.id} />,
    })),
  },
  stageFlow: {
    slotId: 'stageFlow',
    label: 'Stage flow',
    group: 'project',
    canonicalComponent: 'StageStepper + StageAdvance + AutomationBar',
    canonicalFilePath: 'src/components/forge/StageStepper.tsx',
    knobs: GOVERNANCE_KNOBS.stageFlow,
    defaultLocked: true,
    consumers: [
      { id: 'live-stage-stepper', label: 'Live Stage Stepper', filePath: 'src/components/forge/LiveStageStepper.tsx' },
      { id: 'stage-advance', label: 'StageAdvance (advance control)', filePath: 'src/components/forge/StageAdvance.tsx' },
      { id: 'automation-bar', label: 'AutomationBar (gate automation)', filePath: 'src/components/forge/AutomationBar.tsx' },
    ],
    deviations: [],
    // Project-only stage control. Variants: the whole Flow (interactive), the Stepper's
    // visual states, the Advance-button states (phase / stage / gated), and the Automation bar.
    renderPreview: () => <StageFlowPreview />,
    variants: STAGE_FLOW_VARIANTS.map((v) => ({
      id: v.id,
      label: v.label,
      consumers: v.consumers ?? [],
      canonicalComponent: v.canonicalComponent,
      canonicalFilePath: v.canonicalFilePath,
      renderPreview: () => <StageFlowVariant id={v.id} />,
    })),
  },
  button: {
    slotId: 'button',
    label: 'Button',
    group: 'primitive',
    canonicalComponent: 'Button',
    canonicalFilePath: 'src/components/ui/button.tsx',
    knobs: GOVERNANCE_KNOBS.button,
    defaultLocked: true,
    consumers: [
      { id: 'stage-advance', label: 'Project › Stage advance', filePath: 'src/components/forge/StageAdvance.tsx' },
      { id: 'settings-actions', label: 'Settings forms (Save / Cancel)', filePath: 'src/components/forge/SettingCard.tsx' },
      { id: 'new-project', label: 'New project (Create)', filePath: 'app/(app)/projects/new/NewProjectForm.tsx' },
    ],
    deviations: [],
    renderPreview: () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm">Primary</Button>
        <Button size="sm" variant="secondary">Secondary</Button>
        <Button size="sm" variant="ghost">Ghost</Button>
      </div>
    ),
  },
  badge: {
    slotId: 'badge',
    label: 'Badge',
    group: 'primitive',
    canonicalComponent: 'Badge',
    canonicalFilePath: 'src/components/ui/badge.tsx',
    knobs: GOVERNANCE_KNOBS.badge,
    defaultLocked: true,
    consumers: [
      { id: 'table-status', label: 'Table status pills (Loops / Workspace / Members)', filePath: 'app/(app)/loops/LoopsClient.tsx' },
      { id: 'doc-version', label: 'Project › document version badge', filePath: 'src/components/forge/SpecStageClient.tsx' },
      { id: 'workspace-tags', label: 'Workspace repo tags', filePath: 'app/(app)/workspace/WorkspaceClient.tsx' },
    ],
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
  formControl: {
    slotId: 'formControl',
    label: 'Form control',
    group: 'primitive',
    canonicalComponent: 'Field + Input',
    canonicalFilePath: 'src/components/ui/field.tsx',
    knobs: GOVERNANCE_KNOBS.formControl,
    defaultLocked: true,
    consumers: [
      { id: 'profile-form', label: 'Profile', filePath: 'app/(app)/profile/ProfileForm.tsx' },
      { id: 'connections-form', label: 'Org settings › Connections', filePath: 'app/(app)/settings/connections/ConnectionsForm.tsx' },
      { id: 'new-project-form', label: 'New project', filePath: 'app/(app)/projects/new/NewProjectForm.tsx' },
    ],
    deviations: [],
    renderPreview: () => (
      <div className="max-w-sm">
        <Field label="Field label" hint="helper text">{(p) => <Input {...p} placeholder="Value" />}</Field>
      </div>
    ),
  },
  emptyState: {
    slotId: 'emptyState',
    label: 'Empty state',
    group: 'primitive',
    canonicalComponent: 'EmptyState',
    canonicalFilePath: 'src/components/ui/empty-state.tsx',
    knobs: GOVERNANCE_KNOBS.emptyState,
    defaultLocked: true,
    consumers: [
      { id: 'projects-page', label: 'Projects page', filePath: 'app/(app)/projects/page.tsx' },
      { id: 'loops-table', label: 'Loops', filePath: 'app/(app)/loops/LoopsClient.tsx' },
      { id: 'members-table', label: 'Team settings › Members', filePath: 'app/(app)/settings/members/MemberTable.tsx' },
    ],
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
    group: 'primitive',
    canonicalComponent: 'MetricCard',
    canonicalFilePath: 'src/components/ui/metric-card.tsx',
    knobs: GOVERNANCE_KNOBS.metricCard,
    defaultLocked: true,
    consumers: [
      { id: 'team-tab-metrics', label: 'Team settings › Team › Metric row', filePath: 'app/(app)/settings/team/page.tsx' },
      { id: 'usage-dashboard', label: 'Usage dashboard', filePath: 'app/(app)/usage/OrgUsageDashboard.tsx' },
      { id: 'journal-metrics', label: 'Journal › Metric row', filePath: 'app/(app)/journal/page.tsx' },
    ],
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
  banner: {
    slotId: 'banner',
    label: 'Banner',
    group: 'primitive',
    canonicalComponent: 'Banner',
    canonicalFilePath: 'src/components/ui/banner.tsx',
    knobs: GOVERNANCE_KNOBS.banner,
    defaultLocked: true,
    consumers: [
      { id: 'login', label: 'Auth › Login', filePath: 'app/(auth)/login/LoginForm.tsx' },
      { id: 'setup', label: 'Auth › Setup', filePath: 'app/(auth)/setup/SetupForm.tsx' },
      { id: 'spec-plan-banner', label: 'Project › Spec / Plan › Banners', filePath: 'src/components/forge/SpecStageClient.tsx' },
      { id: 'build-monitor', label: 'Build monitor', filePath: 'src/components/forge/BuildMonitor.tsx' },
    ],
    deviations: [],
    renderPreview: () => <Banner variant="warning" title="Content banner" description="A content-level alert with a title and message." />,
  },
  avatar: {
    slotId: 'avatar',
    label: 'Avatar',
    group: 'primitive',
    canonicalComponent: 'Avatar / AvatarGroup',
    canonicalFilePath: 'src/components/ui/avatar.tsx',
    knobs: GOVERNANCE_KNOBS.avatar,
    defaultLocked: true,
    consumers: [
      { id: 'members-table', label: 'Team settings › Members', filePath: 'app/(app)/settings/members/MemberTable.tsx' },
      { id: 'participants', label: 'Project › Approvers strip', filePath: 'src/components/forge/collab/Participants.tsx' },
      { id: 'project-card-avatars', label: 'Projects › Project cards', filePath: 'src/components/forge/ProjectCard.tsx' },
    ],
    deviations: [],
    renderPreview: () => (
      <div className="flex items-center gap-4">
        <Avatar name="Xu Zheng" />
        <AvatarGroup members={[{ name: 'Xu Zheng' }, { name: 'Oscar A' }, { name: 'Ben N' }]} />
      </div>
    ),
  },
  toast: {
    slotId: 'toast',
    label: 'Toast',
    group: 'primitive',
    canonicalComponent: 'showToast() / Toaster',
    canonicalFilePath: 'src/components/ui/toast.tsx',
    knobs: GOVERNANCE_KNOBS.toast,
    defaultLocked: true,
    consumers: [
      { id: 'stage-transitions', label: 'Project stage transitions', filePath: 'src/components/forge/PlanStageClient.tsx' },
      { id: 'workspace', label: 'Workspace', filePath: 'app/(app)/workspace/WorkspaceClient.tsx' },
      { id: 'loops', label: 'Loops', filePath: 'app/(app)/loops/LoopsClient.tsx' },
    ],
    deviations: [],
    // The global toast system: `showToast()` pushes to the app-level `<Toaster/>` (mounted
    // in app/(app)/layout.tsx, fixed bottom-right). Click to fire a real toast.
    renderPreview: () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => showToast({ type: 'success', message: 'Saved — changes applied.' })}>Show success</Button>
        <Button size="sm" variant="secondary" onClick={() => showToast({ type: 'error', message: 'Something went wrong.', retry: () => {} })}>Show error</Button>
      </div>
    ),
  },
};

/**
 * Lightweight, ordered nav index for the left-rail "Components" section and per-slot
 * routing — derived from GOVERNANCE_REGISTRY so it can never drift. Plain data (no
 * preview closures), keyed by the same slot order the registry declares.
 */
export const GOVERNANCE_SLOT_NAV: ReadonlyArray<{
  slotId: GovernanceSlotId;
  label: string;
  group: GovernanceSlotGroup;
  variants: readonly {
    id: string;
    label: string;
    consumers: readonly GovernanceConsumer[];
    canonicalComponent?: string;
    canonicalFilePath?: string;
    affordances?: readonly VariantAffordance[];
    tabs?: readonly VariantTab[];
  }[];
}> = (Object.keys(GOVERNANCE_REGISTRY) as GovernanceSlotId[]).map((slotId) => ({
  slotId,
  label: GOVERNANCE_REGISTRY[slotId].label,
  group: GOVERNANCE_REGISTRY[slotId].group,
  variants: (GOVERNANCE_REGISTRY[slotId].variants ?? []).map((v) => ({
    id: v.id,
    label: v.label,
    consumers: v.consumers ?? [],
    canonicalComponent: v.canonicalComponent,
    canonicalFilePath: v.canonicalFilePath,
    affordances: v.affordances,
    tabs: v.tabs,
  })),
}));

/** Valid slot ids, for validating a dynamic `[slotId]` route param. */
export const GOVERNANCE_SLOT_IDS: ReadonlySet<string> = new Set(Object.keys(GOVERNANCE_REGISTRY));
