import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NodeDetail } from '@/components/forge/journal/NodeDetail';
import type { JournalNode, InboundEdge } from '@/journal/types';

const NODE: JournalNode = {
  id: '0002',
  title: 'Prefer parallel dispatch',
  status: 'adopted',
  tags: ['concurrency', 'dispatch'],
  date: '2026-05-24',
  links: [
    { type: 'supersedes', target: '0001' },
    { type: 'depends-on', target: '0004' },
  ],
  supersededBy: null,
  context: 'Some context prose about parallel dispatch.',
  consequences: 'Some consequence prose.',
  crux: 'Fix the dangerous operation precisely.',
  filename: 'nodes/0002-prefer.md',
};

const INBOUND: InboundEdge[] = [
  { label: 'child', source: '0004' },
  { label: 'superseded-by', source: '0009' },
];

describe('NodeDetail', () => {
  it('renders status, title-as-crux, the crux subtitle, tags, filename', () => {
    render(<NodeDetail node={NODE} inbound={INBOUND} onNavigate={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Prefer parallel dispatch' })).toBeInTheDocument();
    expect(screen.getByText('Fix the dangerous operation precisely.')).toBeInTheDocument();
    expect(screen.getByText('adopted')).toBeInTheDocument();
    expect(screen.getByText('concurrency')).toBeInTheDocument();
    expect(screen.getByText('nodes/0002-prefer.md')).toBeInTheDocument();
  });

  it('renders outgoing edges and server-computed inbound edges with the inverse labels', () => {
    render(<NodeDetail node={NODE} inbound={INBOUND} onNavigate={() => {}} />);
    // outgoing
    expect(screen.getByRole('button', { name: 'supersedes → node 0001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'depends-on → node 0004' })).toBeInTheDocument();
    // inbound (inverse labels)
    expect(screen.getByRole('button', { name: 'child ← node 0004' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'superseded-by ← node 0009' })).toBeInTheDocument();
  });

  it('renders Context and Consequences markdown', () => {
    render(<NodeDetail node={NODE} inbound={[]} onNavigate={() => {}} />);
    expect(screen.getByText(/context prose about parallel dispatch/i)).toBeInTheDocument();
    expect(screen.getByText(/consequence prose/i)).toBeInTheDocument();
  });

  it('no crux subtitle when crux is null (title-only)', () => {
    render(<NodeDetail node={{ ...NODE, crux: null }} inbound={[]} onNavigate={() => {}} />);
    expect(screen.queryByText('Fix the dangerous operation precisely.')).toBeNull();
  });

  it('sanitizes hostile markdown — no raw <script>/<img onerror> element reaches the DOM (F15)', () => {
    const hostile: JournalNode = {
      ...NODE,
      context: 'before <img src=x onerror="alert(1)"> <script>alert(2)</script> after',
      consequences: '[click](javascript:alert(3))',
    };
    const { container } = render(<NodeDetail node={hostile} inbound={[]} onNavigate={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const dangerousHref = Array.from(container.querySelectorAll('a')).some((a) =>
      (a.getAttribute('href') ?? '').toLowerCase().startsWith('javascript:'),
    );
    expect(dangerousHref).toBe(false);
  });

  it('renders an unparseable-node pane (no crash) when given a parse error', () => {
    render(
      <NodeDetail
        node={null}
        parseError={{ id: '0006', filename: 'nodes/0006-broken.md', reason: 'missing frontmatter' }}
        inbound={[]}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText(/could not parse this node/i)).toBeInTheDocument();
    expect(screen.getByText('nodes/0006-broken.md')).toBeInTheDocument();
  });
});
