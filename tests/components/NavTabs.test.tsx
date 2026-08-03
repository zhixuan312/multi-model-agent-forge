import { render, screen } from '@testing-library/react';
import { NavTabs } from '@/components/ui/nav-tabs';

const TABS = [
  { key: 'recall', label: 'Recall', href: '/journal?view=recall' },
  { key: 'nodes', label: 'Nodes', href: '/journal?view=nodes' },
];

describe('NavTabs', () => {
  it('names the tablist so a screen reader can tell one sub-nav from another', () => {
    render(<NavTabs tabs={TABS} active="recall" label="Journal views" />);
    expect(screen.getByRole('tablist', { name: 'Journal views' })).toBeInTheDocument();
  });

  it('marks exactly one tab selected, and marks it aria-current="page"', () => {
    render(<NavTabs tabs={TABS} active="nodes" label="Journal views" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Nodes');
    // These are real navigation, not an in-page switcher: the active tab is the current page.
    expect(selected[0]).toHaveAttribute('aria-current', 'page');
    expect(tabs.find((t) => t.textContent === 'Recall')).not.toHaveAttribute('aria-current');
  });

  it('renders each tab as a link to its own href', () => {
    render(<NavTabs tabs={TABS} active="recall" label="Journal views" />);
    expect(screen.getByRole('tab', { name: 'Nodes' })).toHaveAttribute('href', '/journal?view=nodes');
  });

  it('an unmatched active key selects nothing rather than defaulting to the first tab', () => {
    render(<NavTabs tabs={TABS} active="graph" label="Journal views" />);
    expect(screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(0);
  });

  it('renders nothing for an empty tab list', () => {
    const { container } = render(<NavTabs tabs={[]} active="x" label="Empty" />);
    expect(container).toBeEmptyDOMElement();
  });
});
