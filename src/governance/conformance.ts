import type { GovernanceSlotId } from '@/components/governance/registry';

export type { GovernanceSlotId } from '@/components/governance/registry';

/**
 * Application-level conformance checker (pure, fs-free — the runner in `conformance-scan.ts`
 * feeds it the repo's files). It walks the LAYER STACK — background → app shell → content
 * shell → stage flow → left panel (primary) → right panel (aside) — and flags any page or
 * component that does not match the convention, in BOTH directions:
 *
 *   • `extra`   — the file hand-rolls something a governed component already owns
 *                 (a raw <table>, a duplicated rail note, a bare <StageStepper>).
 *   • `missing` — the file omits a part the layer requires
 *                 (a page with no PageFrame, a StageShell with no rail note).
 *
 * Rules are deliberately HIGH-SIGNAL (an exact class signature, a specific element, a named
 * import) so the report is accurate: sanctioned exceptions — the canonical components
 * themselves, redirect-only pages, project routes framed by the project layout, export
 * HTML builders, and the governance previews that demo components by design — never fire.
 */

export interface SourceFile {
  /** Repo-relative POSIX path, e.g. `app/(app)/foo/page.tsx`. */
  path: string;
  content: string;
}

export type ViolationKind = 'extra' | 'missing';

export interface ConformanceViolation {
  slotId: GovernanceSlotId;
  file: string;
  kind: ViolationKind;
  reason: string;
}

export interface ConformanceRule {
  slotId: GovernanceSlotId;
  label: string;
  /** One-line statement of the convention this rule enforces. */
  convention: string;
  /** Whether this file is subject to the rule. */
  scope: (path: string) => boolean;
  /** Every way this file departs from the convention (empty when it conforms). */
  violations: (file: SourceFile) => { kind: ViolationKind; reason: string }[];
}

/* ── shared predicates ──────────────────────────────────────────────────── */

const isTsx = (p: string) => p.endsWith('.tsx');
const is = (p: string, suffix: string) => p === suffix || p.endsWith('/' + suffix);
/** Governance previews demo the governed components by design — never violations. */
const isGovernancePreview = (p: string) => p.includes('src/components/governance/');
/** `src/export/**` builds PDF/HTML export documents as strings, not app UI. */
const isExportBuilder = (p: string) => p.includes('src/export/');

/** The exact StageShell dashboard grid — the structure the Content Shell standardises. */
const DASHBOARD_GRID = 'grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch';
/** RailNote's exact tinted-note signature (r-lg + /40 tint) — a tinted menu row won't match. */
const RAIL_NOTE_SIGNATURE = 'rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40';

const SHELL = 'src/components/ui/shell.tsx';
const isAuthedPage = (p: string) => /^app\/\(app\)\/(?:.*\/)?page\.tsx$/.test(p);
/** Project stage routes get their frame from `projects/[id]/layout.tsx`. */
const isProjectRoute = (p: string) => p.includes('app/(app)/projects/[id]/');
/** A page that returns JSX renders UI; a redirect-only page has no such return. */
const rendersUi = (content: string) => /return\s*[<(]/.test(content);

export const CONFORMANCE_RULES: readonly ConformanceRule[] = [
  {
    slotId: 'background',
    label: 'Background',
    convention: 'The app background is the single `.app-bg` class — never a hand-rolled full-page fill.',
    scope: (p) => isTsx(p) && !isGovernancePreview(p),
    violations: (f) => {
      const out: { kind: ViolationKind; reason: string }[] = [];
      if (is(f.path, SHELL) && !f.content.includes('app-bg')) {
        out.push({ kind: 'missing', reason: 'the app shell no longer applies the canonical `.app-bg` background' });
      }
      if (!is(f.path, SHELL) && /fixed inset-0/.test(f.content) && /(radial|linear)-gradient/.test(f.content)) {
        out.push({ kind: 'extra', reason: 'paints its own full-page background instead of using `.app-bg`' });
      }
      return out;
    },
  },
  {
    slotId: 'appShell',
    label: 'App shell',
    convention: 'Every authed page frames through PageFrame (project routes via the project layout shell).',
    scope: (p) => isAuthedPage(p),
    violations: (f) => {
      if (isProjectRoute(f.path)) return []; // framed by projects/[id]/layout.tsx
      if (f.content.includes('PageFrame')) return [];
      if (!rendersUi(f.content)) return []; // redirect-only page renders no UI
      return [{ kind: 'missing' as const, reason: 'renders UI without PageFrame — hand-rolled page frame' }];
    },
  },
  {
    slotId: 'contentShell',
    label: 'Content shell',
    convention: 'Use StatusDashboard / StageShell instead of hand-rolling the 2⁄3 + 1⁄3 dashboard grid.',
    scope: (p) =>
      isTsx(p) &&
      !is(p, 'src/components/patterns/stage-shell.tsx') &&
      !is(p, 'src/components/patterns/status-dashboard.tsx'),
    violations: (f) =>
      f.content.includes(DASHBOARD_GRID)
        ? [{ kind: 'extra' as const, reason: 'hand-rolls the dashboard grid (lg:grid-cols-3 lg:items-stretch) instead of StageShell' }]
        : [],
  },
  {
    slotId: 'stageFlow',
    label: 'Stage flow',
    convention: 'Project routes render the stepper via LiveStageStepper, never a bare <StageStepper>.',
    scope: (p) =>
      isTsx(p) &&
      !is(p, 'src/components/forge/LiveStageStepper.tsx') &&
      !is(p, 'src/components/forge/StageStepper.tsx') &&
      !isGovernancePreview(p),
    violations: (f) =>
      /<StageStepper[\s/>]/.test(f.content)
        ? [{ kind: 'extra' as const, reason: 'renders <StageStepper> directly instead of via LiveStageStepper' }]
        : [],
  },
  {
    slotId: 'leftPanel',
    label: 'Left panel (primary)',
    convention: 'Tabular content uses the governed DataTable — never a raw <table>.',
    scope: (p) =>
      isTsx(p) &&
      // The canonical table primitives themselves legitimately render <table>.
      !is(p, 'src/components/ui/data-table.tsx') &&
      !is(p, 'src/components/ui/table.tsx') &&
      !isExportBuilder(p) &&
      !isGovernancePreview(p),
    violations: (f) =>
      /<table[\s/>]/.test(f.content)
        ? [{ kind: 'extra' as const, reason: 'hand-rolls a raw <table> instead of the governed DataTable' }]
        : [],
  },
  {
    slotId: 'rightPanel',
    label: 'Right panel (aside)',
    convention: 'The rail is a RailNote plus a governed panel — every StageShell supplies its note.',
    scope: (p) =>
      isTsx(p) &&
      !is(p, 'src/components/patterns/feature-rail.tsx') &&
      !is(p, 'src/components/patterns/stage-shell.tsx') &&
      !isGovernancePreview(p),
    violations: (f) => {
      const out: { kind: ViolationKind; reason: string }[] = [];
      if (f.content.includes(RAIL_NOTE_SIGNATURE)) {
        out.push({ kind: 'extra', reason: 'hand-rolls the rail note instead of using RailNote' });
      }
      if (/<StageShell[\s>]/.test(f.content) && !/\bnote=/.test(f.content)) {
        out.push({ kind: 'missing', reason: 'uses StageShell without a rail `note` — the rail has no guidance' });
      }
      return out;
    },
  },
];

/** Run every rule over every in-scope file and collect the violations. */
export function checkConformance(
  files: readonly SourceFile[],
  rules: readonly ConformanceRule[] = CONFORMANCE_RULES,
): ConformanceViolation[] {
  const out: ConformanceViolation[] = [];
  for (const rule of rules) {
    for (const f of files) {
      if (!rule.scope(f.path)) continue;
      for (const v of rule.violations(f)) {
        out.push({ slotId: rule.slotId, file: f.path, kind: v.kind, reason: v.reason });
      }
    }
  }
  return out;
}

/** Per-layer conformance — how many files were checked and which depart from the convention. */
export interface LayerConformance {
  slotId: GovernanceSlotId;
  label: string;
  convention: string;
  checked: number;
  violations: ConformanceViolation[];
}

export function summarizeConformance(
  files: readonly SourceFile[],
  rules: readonly ConformanceRule[] = CONFORMANCE_RULES,
): LayerConformance[] {
  return rules.map((rule) => {
    const inScope = files.filter((f) => rule.scope(f.path));
    const violations: ConformanceViolation[] = [];
    for (const f of inScope) {
      for (const v of rule.violations(f)) {
        violations.push({ slotId: rule.slotId, file: f.path, kind: v.kind, reason: v.reason });
      }
    }
    return { slotId: rule.slotId, label: rule.label, convention: rule.convention, checked: inScope.length, violations };
  });
}

/** Whether a governed slot has an automated conformance rule. */
export function hasConformanceRule(slotId: GovernanceSlotId): boolean {
  return CONFORMANCE_RULES.some((r) => r.slotId === slotId);
}
