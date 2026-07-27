import { readFileSync } from 'node:fs';
import { act, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import DirectionPage from '../../app/(app)/direction/page';

vi.mock('@/components/ui', () => ({
  PageFrame: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <main data-testid="page-frame"><h1>{title}</h1>{children}</main>
  ),
}));
vi.mock('@/components/direction/DirectionSection', () => ({
  DirectionSection: ({ section }: { section: { id: string; title: string } }) => <h2 data-testid="selected">{section.id}:{section.title}</h2>,
}));

beforeEach(() => window.history.replaceState(null, '', '/direction#insight-and-bet'));

describe('/direction', () => {
  it('is a client page and renders the complete manual inside PageFrame', () => {
    expect(readFileSync('app/(app)/direction/page.tsx', 'utf8').trimStart().startsWith("'use client'")).toBe(true);
    render(<DirectionPage />);
    expect(screen.getByTestId('page-frame')).toBeInTheDocument();
    expect(screen.getByText('The product')).toBeInTheDocument();
    expect(screen.getByText('The engine · shared by both modes')).toBeInTheDocument();
    expect(screen.getByText('The backend · how the engine runs')).toBeInTheDocument();
    expect(screen.getByText('Forge · the team app')).toBeInTheDocument();
    expect(screen.getByText('Telemetry · proof surface')).toBeInTheDocument();
    expect(screen.getByTestId('selected')).toHaveTextContent('insight-and-bet:The insight');
  });

  it('renders the section selected by a later valid browser hash change', () => {
    render(<DirectionPage />);
    act(() => {
      window.history.pushState(null, '', '/direction#principles');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByTestId('selected')).toHaveTextContent('principles:The global principles');
  });
});
