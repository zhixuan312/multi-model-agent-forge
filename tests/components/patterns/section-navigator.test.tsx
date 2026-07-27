import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { SectionNavigator } from '@/components/patterns';

// The navigator is a GENERIC pattern — its test uses a local record shape rather
// than the Direction content, so nothing here couples `patterns/` to a feature.
interface TestSection {
  id: string;
  part: string;
  subgroup?: string;
  title: string;
  body: string;
}

const sections: TestSection[] = [
  { id: 'insight-and-bet', part: 'product', title: 'The insight', body: 'First' },
  { id: 'principles', part: 'product', title: 'The global principles', body: 'Second' },
  { id: 'tool-audit', part: 'engine', subgroup: 'Read-only', title: 'Audit', body: 'Third' },
];
const parts = [
  { part: 'product', title: 'The product' },
  { part: 'engine', title: 'The engine · shared by both modes' },
];

beforeEach(() => window.history.replaceState(null, '', '/direction'));
afterEach(() => vi.restoreAllMocks());

describe('SectionNavigator', () => {
  it('uses a valid initial hash without rewriting it and renders one selected section', () => {
    window.history.replaceState(null, '', '/direction#tool-audit');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    render(<SectionNavigator sections={sections} parts={parts}>{(section) => <output>{section.id}</output>}</SectionNavigator>);
    expect(screen.getByText('tool-audit')).toBeInTheDocument();
    expect(screen.queryByText('insight-and-bet')).not.toBeInTheDocument();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('updates the selected section on hashchange', () => {
    render(<SectionNavigator sections={sections} parts={parts}>{(section) => <output>{section.id}</output>}</SectionNavigator>);
    act(() => {
      window.history.pushState(null, '', '/direction#principles');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByText('principles')).toBeInTheDocument();
    expect(screen.queryByText('insight-and-bet')).not.toBeInTheDocument();
  });

  it.each(['', '#missing'])('normalizes %s to the first section with replaceState', (hash) => {
    window.history.replaceState(null, '', `/direction${hash}`);
    const replaceState = vi.spyOn(window.history, 'replaceState');
    render(<SectionNavigator sections={sections} parts={parts}>{(section) => <output>{section.id}</output>}</SectionNavigator>);
    expect(screen.getByText('insight-and-bet')).toBeInTheDocument();
    expect(window.location.hash).toBe('#insight-and-bet');
    expect(replaceState).toHaveBeenCalledWith(null, '', '#insight-and-bet');
  });

  it('renders literal anchors and marks only the selected one current', () => {
    render(<SectionNavigator sections={sections} parts={parts}>{(section) => <output>{section.id}</output>}</SectionNavigator>);
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    for (const section of sections) {
      expect(screen.getByRole('link', { name: section.title })).toHaveAttribute('href', `#${section.id}`);
    }
    expect(screen.getByRole('link', { name: 'The insight' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Audit' })).not.toHaveAttribute('aria-current');
  });

  it('removes its hashchange listener on unmount', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <SectionNavigator sections={sections} parts={parts}>{(section) => <output>{section.id}</output>}</SectionNavigator>,
    );
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('hashchange', expect.any(Function));
  });

  it('fails fast with a clear development error when sections is empty (invalid caller contract)', () => {
    const empty: TestSection[] = [];
    expect(() =>
      render(<SectionNavigator sections={empty} parts={parts}>{(section) => <output>{section.id}</output>}</SectionNavigator>),
    ).toThrow(/section/i);
  });
});
