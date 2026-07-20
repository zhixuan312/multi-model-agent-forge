import {
  checkConformance,
  summarizeConformance,
  hasConformanceRule,
  CONFORMANCE_RULES,
  type SourceFile,
} from '@/governance/conformance';

function check(files: SourceFile[]) {
  return checkConformance(files, CONFORMANCE_RULES);
}
const forSlot = (files: SourceFile[], slotId: string) => check(files).filter((v) => v.slotId === slotId);

describe('governance conformance checker', () => {
  it('covers every layer of the stack, background → primary → aside', () => {
    expect(CONFORMANCE_RULES.map((r) => r.slotId)).toEqual([
      'background',
      'appShell',
      'contentShell',
      'stageFlow',
      'leftPanel',
      'rightPanel',
    ]);
    expect(hasConformanceRule('leftPanel')).toBe(true);
    expect(hasConformanceRule('badge')).toBe(false);
  });

  describe('background', () => {
    it('flags the app shell when it stops applying .app-bg (missing)', () => {
      const v = forSlot([{ path: 'src/components/ui/shell.tsx', content: `<div className="fixed inset-0 flex" />` }], 'background');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('missing');
    });

    it('passes when the shell applies .app-bg', () => {
      const v = forSlot([{ path: 'src/components/ui/shell.tsx', content: `<div className="app-bg fixed inset-0 flex" />` }], 'background');
      expect(v).toEqual([]);
    });

    it('flags a hand-rolled full-page background elsewhere (extra)', () => {
      const v = forSlot([{ path: 'src/components/forge/Thing.tsx', content: `<div className="fixed inset-0" style={{ background: 'radial-gradient(x)' }} />` }], 'background');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('extra');
    });

    it('does not flag a decorative gradient that is not full-page', () => {
      const v = forSlot([{ path: 'src/components/forge/Mark.tsx', content: `<svg fill="url(#g)"><linearGradient id="g"/></svg>` }], 'background');
      expect(v).toEqual([]);
    });
  });

  describe('app shell', () => {
    it('flags an authed page that renders UI without PageFrame (missing)', () => {
      const v = forSlot([{ path: 'app/(app)/foo/page.tsx', content: `export default function P(){ return (<div>hello</div>); }` }], 'appShell');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('missing');
    });

    it('passes a page using PageFrame, a redirect-only page, and a project route', () => {
      const v = forSlot([
        { path: 'app/(app)/a/page.tsx', content: `import { PageFrame } from '@/components/ui'; export default function P(){ return (<PageFrame/>); }` },
        { path: 'app/(app)/settings/page.tsx', content: `import { redirect } from 'next/navigation'; export default function P(){ redirect('/x'); }` },
        { path: 'app/(app)/projects/[id]/spec/page.tsx', content: `export default function P(){ return (<div>spec</div>); }` },
      ], 'appShell');
      expect(v).toEqual([]);
    });
  });

  describe('content shell', () => {
    const GRID = 'grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch';

    it('flags a hand-rolled dashboard grid (extra)', () => {
      const v = forSlot([{ path: 'app/(app)/foo/page.tsx', content: `<div className="${GRID}">x</div>` }], 'contentShell');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('extra');
    });

    it('does not flag the canonical StageShell / StatusDashboard', () => {
      const v = forSlot([
        { path: 'src/components/patterns/stage-shell.tsx', content: `<div className="${GRID}" />` },
        { path: 'src/components/patterns/status-dashboard.tsx', content: `<div className="${GRID}" />` },
      ], 'contentShell');
      expect(v).toEqual([]);
    });
  });

  describe('stage flow', () => {
    it('flags a bare <StageStepper> (extra)', () => {
      const v = forSlot([{ path: 'src/components/forge/Foo.tsx', content: `<StageStepper stages={[]} />` }], 'stageFlow');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('extra');
    });

    it('does not flag the sanctioned wrapper, the definition, or governance previews', () => {
      const v = forSlot([
        { path: 'src/components/forge/LiveStageStepper.tsx', content: `<StageStepper stages={[]} />` },
        { path: 'src/components/forge/StageStepper.tsx', content: `export function StageStepper(){ return null; }` },
        { path: 'src/components/governance/StageFlowPreview.tsx', content: `<StageStepper stages={[]} />` },
      ], 'stageFlow');
      expect(v).toEqual([]);
    });
  });

  describe('left panel (primary)', () => {
    it('flags a raw <table> that bypasses the governed DataTable (extra)', () => {
      const v = forSlot([{ path: 'app/(app)/usage/Foo.tsx', content: `<table><tbody/></table>` }], 'leftPanel');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('extra');
    });

    it('does not flag the canonical table primitives, export HTML builders, or governance previews', () => {
      const v = forSlot([
        { path: 'src/components/ui/data-table.tsx', content: `<table/>` },
        { path: 'src/components/ui/table.tsx', content: `export function Table(){ return <table/>; }` },
        { path: 'src/export/pdf/template.ts', content: `const html = '<table></table>'` },
        { path: 'src/components/governance/LeftPanelPreview.tsx', content: `<table/>` },
      ], 'leftPanel');
      expect(v).toEqual([]);
    });
  });

  describe('right panel (aside)', () => {
    const RAIL_NOTE = 'rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40';

    it('flags a hand-rolled rail note (extra)', () => {
      const v = forSlot([{ path: 'src/components/forge/Foo.tsx', content: `<div className="flex items-start gap-3 ${RAIL_NOTE} px-4 py-4" />` }], 'rightPanel');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('extra');
    });

    it('does NOT flag a tinted menu item that merely shares the accent tint', () => {
      const v = forSlot([{ path: 'src/components/forge/ExportMenu.tsx', content: `<button className="flex w-full items-center gap-3 rounded-[var(--r-md)] border border-accent-tint bg-accent-tint px-3 py-3" />` }], 'rightPanel');
      expect(v).toEqual([]);
    });

    it('flags a StageShell used without its rail note (missing)', () => {
      const v = forSlot([{ path: 'app/(app)/usage/Dash.tsx', content: `<StageShell metrics={m}>{body}</StageShell>` }], 'rightPanel');
      expect(v).toHaveLength(1);
      expect(v[0].kind).toBe('missing');
    });

    it('passes a StageShell that supplies a note', () => {
      const v = forSlot([{ path: 'app/(app)/loops/page.tsx', content: `<StageShell note={<RailNote/>}>{body}</StageShell>` }], 'rightPanel');
      expect(v).toEqual([]);
    });
  });

  it('reports checked count + violations per layer', () => {
    const files: SourceFile[] = [
      { path: 'app/(app)/a/page.tsx', content: `import { PageFrame } from '@/components/ui'; export default function P(){ return (<PageFrame/>); }` },
      { path: 'app/(app)/b/page.tsx', content: `export default function P(){ return (<div>x</div>); }` },
    ];
    const appShell = summarizeConformance(files).find((s) => s.slotId === 'appShell')!;
    expect(appShell.checked).toBe(2);
    expect(appShell.violations).toHaveLength(1);
    expect(appShell.violations[0].file).toBe('app/(app)/b/page.tsx');
  });
});
