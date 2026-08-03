import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { DirectionSection } from '@/components/direction/DirectionSection';

// The module itself, not the deleted `patterns` barrel — every consumer imports ProseBlock
// from its own file now, so mocking the barrel intercepted nothing.
vi.mock('@/components/patterns/prose-block', () => ({
  ProseBlock: ({ children }: { children: string }) => <div data-testid="prose">{children}</div>,
}));
vi.mock('@/components/direction/PrinciplesGrid', () => ({ PrinciplesGrid: () => <div data-testid="principles" /> }));
vi.mock('@/components/direction/LifecycleFlow', () => ({ LifecycleFlow: () => <div data-testid="lifecycle" /> }));
vi.mock('@/components/direction/LayersStack', () => ({ LayersStack: () => <div data-testid="layers" /> }));
vi.mock('@/components/direction/StageFlow', () => ({ StageFlow: () => <div data-testid="write-stages" /> }));
vi.mock('@/components/direction/ResearchSources', () => ({ ResearchSources: () => <div data-testid="research-sources" /> }));
vi.mock('@/components/direction/JournalMechanism', () => ({
  JournalRecordMechanism: () => <div data-testid="journal-record" />,
  JournalRecallMechanism: () => <div data-testid="journal-recall" />,
}));
vi.mock('@/components/direction/RouteBlock', () => ({
  RouteBlock: ({ routeKey }: { routeKey: string }) => <div data-testid={`route-${routeKey}`} />,
}));

describe('DirectionSection', () => {
  it.each([
    ['principles', 'principles'], ['lifecycle', 'lifecycle'], ['layers', 'layers'],
    ['write-stages', 'write-stages'], ['research-sources', 'research-sources'],
    ['journal-record', 'journal-record'], ['journal-recall', 'journal-recall'],
  ] as const)('dispatches %s to its structured renderer', (component, testId) => {
    render(<DirectionSection section={{ id: component, part: 'product', title: component, body: 'Body', component }} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it.each(['audit', 'review', 'debug', 'investigate'] as const)('dispatches route key %s', (routeKey) => {
    render(<DirectionSection section={{ id: routeKey, part: 'engine', title: routeKey, body: 'Body', routeKey }} />);
    expect(screen.getByTestId(`route-${routeKey}`)).toBeInTheDocument();
  });

  it('sends narrative and under-the-hood markdown through ProseBlock', () => {
    render(<DirectionSection section={{ id: 'x', part: 'forge', title: 'X', body: '**Body**', underTheHood: '`src/x.ts`' }} />);
    expect(screen.getAllByTestId('prose').map((node) => node.textContent)).toEqual(['**Body**', '`src/x.ts`']);
    expect(screen.getByText('In the code')).toBeInTheDocument();
  });

  it('keeps all direction modules free of an additional markdown or CSS system', () => {
    for (const path of [
      'src/components/direction/DirectionSection.tsx',
      'src/components/direction/PrinciplesGrid.tsx', 'src/components/direction/LifecycleFlow.tsx',
      'src/components/direction/LayersStack.tsx', 'src/components/direction/RouteBlock.tsx',
      'src/components/direction/StageFlow.tsx', 'src/components/direction/ResearchSources.tsx',
      'src/components/direction/JournalMechanism.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/react-markdown|remark-gfm|direction\.css|telemetry-frontend/);
    }
  });
});
