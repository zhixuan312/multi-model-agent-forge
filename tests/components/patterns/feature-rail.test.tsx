import { render, screen } from '@testing-library/react';
import { FeatureRail, RailNote, RailCard, RailStatus } from '@/components/patterns/feature-rail';

describe('FeatureRail', () => {
  it('renders children in a vertical stack', () => {
    const { container } = render(
      <FeatureRail>
        <RailNote icon={<svg data-testid="icon" />}>Note content</RailNote>
        <RailCard title="Card">Card content</RailCard>
      </FeatureRail>,
    );
    const stack = container.firstElementChild!;
    expect(stack.children).toHaveLength(2);
    expect(stack.className).toContain('flex');
    expect(stack.className).toContain('flex-col');
  });
});

describe('RailNote', () => {
  it('renders the icon in a tinted circle', () => {
    render(<RailNote icon={<svg data-testid="icon" />}>Content</RailNote>);
    const icon = screen.getByTestId('icon');
    expect(icon.closest('[aria-hidden]')).toBeInTheDocument();
  });

  it('renders markdown content', () => {
    render(<RailNote icon={<svg />}>**bold**</RailNote>);
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders an optional title', () => {
    render(<RailNote icon={<svg />} title="Access">Content</RailNote>);
    expect(screen.getByText('Access')).toBeInTheDocument();
  });
});

describe('RailCard', () => {
  it('renders a titled card section', () => {
    render(<RailCard title="Attention"><p>Item 1</p></RailCard>);
    expect(screen.getByText('Attention')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });

  it('renders an optional badge count', () => {
    render(<RailCard title="Issues" badge={3}><p>Items</p></RailCard>);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('RailStatus', () => {
  it('renders status items with labels', () => {
    render(
      <RailStatus
        items={[
          { id: '1', label: 'Investigate', status: 'running', detail: 'Analyzing code' },
          { id: '2', label: 'Research', status: 'done', detail: 'Completed' },
        ]}
      />,
    );
    expect(screen.getByText('Investigate')).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('renders empty state when no items', () => {
    render(<RailStatus items={[]} emptyText="No tasks yet." />);
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
  });

  it('applies aria-live when live prop is set', () => {
    const { container } = render(<RailStatus items={[]} live />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });
});
