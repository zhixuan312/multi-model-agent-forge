// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from '@/components/ui/tab-bar';

const tabs = [
  { id: 'spec', label: 'Spec' },
  { id: 'audit', label: 'Audit' },
];

describe('TabBar', () => {
  it('renders nothing at all for an empty tab set', () => {
    const { container } = render(<TabBar tabs={[]} activeTab="spec" />);
    expect(container.firstChild).toBeNull();
  });

  it('switches on click and reports which tab is selected', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={tabs} activeTab="spec" onTabChange={onTabChange} />);

    const [spec, audit] = screen.getAllByRole('tab');
    expect(spec).toHaveAttribute('aria-selected', 'true');
    expect(audit).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(audit);
    expect(onTabChange).toHaveBeenCalledWith('audit');
  });

  /**
   * Without `onTabChange` the bar is read-only — the caller drives the active tab elsewhere.
   * Those children used to be plain `<span>`s inside a `role="tablist"`: a tablist with no
   * tabs, where WHICH one is current was left to the background colour alone.
   */
  it('still exposes read-only tabs, and says which is current', () => {
    render(<TabBar tabs={tabs} activeTab="audit" />);

    const found = screen.getAllByRole('tab');
    expect(found).toHaveLength(2);
    expect(found[1]).toHaveAttribute('aria-selected', 'true');
    // Not operable — the caller owns the state, so they must not read as pressable.
    for (const t of found) expect(t).toHaveAttribute('aria-disabled', 'true');
  });
});
