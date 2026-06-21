import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RecallSources, RecallAnswer } from '@/components/forge/journal/RecallView';
import type { ParsedRecall } from '@/journal/recall';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const INDEX = [
  { id: '0001', title: 'Derive completion', status: 'adopted' },
  { id: '0008', title: 'Single read path', status: 'adopted' },
];

describe('RecallAnswer + RecallSources', () => {
  it('renders the synthesis (sanitized) and the mma-journal-recall chip', () => {
    const parsed: ParsedRecall = {
      summary: 'We gate completion on objective signals.',
      findings: [],
      citationIds: [],
    };
    render(<RecallAnswer parsed={parsed} index={INDEX} onNavigate={() => {}} />);
    expect(screen.getByText(/gate completion on objective signals/i)).toBeInTheDocument();
    expect(screen.getByText('mma-journal-recall')).toBeInTheDocument();
  });

  it('renders each learning with its node chip and resolves Sources rows (id · status · title)', () => {
    const parsed: ParsedRecall = {
      summary: 'answer',
      findings: [
        { learning: 'Completion gating', context: 'refines 0008', relevance: 'critical', nodeId: '0001', category: 'decision', status: 'adopted' },
        { learning: 'Single read path', context: 'depends on 0001', relevance: 'high', nodeId: '0008', category: 'design', status: 'adopted' },
      ],
      citationIds: ['0001', '0008'],
    };
    render(<RecallAnswer parsed={parsed} index={INDEX} onNavigate={() => {}} />);
    // each finding shows its learning + its single node chip
    const finding = screen.getByTestId('recall-finding-0');
    expect(within(finding).getByText('Completion gating')).toBeInTheDocument();
    expect(within(finding).getByText('0001')).toBeInTheDocument();

    // Sources list resolves title+status
    const sources = screen.getByTestId('recall-sources');
    expect(within(sources).getByText('Derive completion')).toBeInTheDocument();
    expect(within(sources).getByText('Single read path')).toBeInTheDocument();
  });

  it('an unknown cited id → "(unknown node)" in Sources', () => {
    render(
      <RecallSources ids={['9999']} index={INDEX} onNavigate={() => {}} />,
    );
    expect(screen.getByText('(unknown node)')).toBeInTheDocument();
  });

  it('recall miss → synthesis shown, empty Sources, no error', () => {
    const parsed: ParsedRecall = { summary: 'No prior learnings.', findings: [], citationIds: [] };
    render(<RecallAnswer parsed={parsed} index={INDEX} onNavigate={() => {}} />);
    expect(screen.getByText('No prior learnings.')).toBeInTheDocument();
    expect(screen.queryByTestId('recall-sources')).toBeNull();
  });

  it('sanitizes a hostile synthesis (no raw <script> reaches the DOM, F15)', () => {
    const parsed: ParsedRecall = {
      summary: 'safe <script>alert(1)</script> <img src=x onerror="alert(2)">',
      findings: [],
      citationIds: [],
    };
    const { container } = render(<RecallAnswer parsed={parsed} index={INDEX} onNavigate={() => {}} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
