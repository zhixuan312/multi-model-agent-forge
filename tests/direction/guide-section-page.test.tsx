import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import GuideSectionPage from '../../app/(app)/settings/guide/[sectionId]/page';
import GuideIndexPage from '../../app/(app)/settings/guide/page';

// `redirect()` never returns in Next — it throws to unwind the render. The mock
// keeps that contract so the pages' guard clauses behave as they do in production.
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`);
  },
}));
vi.mock('@/components/ui', () => ({
  PageFrame: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <main data-testid="page-frame"><h1>{title}</h1>{children}</main>
  ),
}));
vi.mock('@/components/direction/DirectionSection', () => ({
  DirectionSection: ({ section }: { section: { id: string; title: string } }) => (
    <h2 data-testid="selected">{section.id}:{section.title}</h2>
  ),
}));

describe('/settings/guide', () => {
  it('lands the bare index on the first section', () => {
    expect(() => GuideIndexPage()).toThrow('REDIRECT:/settings/guide/insight-and-bet');
  });
});

describe('/settings/guide/[sectionId]', () => {
  it('renders ONLY the requested section — no masthead, no in-content nav', async () => {
    render(await GuideSectionPage({ params: Promise.resolve({ sectionId: 'principles' }) }));

    expect(screen.getByTestId('page-frame')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Guide');
    expect(screen.getByTestId('selected')).toHaveTextContent('principles:The global principles');

    // The section index lives in the sidebar rail — the centre area carries neither
    // the manifesto masthead nor a second menu.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText('The product')).not.toBeInTheDocument();
    expect(screen.queryByText(/full AI software development lifecycle/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('selected')).toHaveLength(1);
  });

  it('sends an unknown section id back to the manual’s opening section', async () => {
    await expect(
      GuideSectionPage({ params: Promise.resolve({ sectionId: 'no-such-section' }) }),
    ).rejects.toThrow('REDIRECT:/settings/guide/insight-and-bet');
  });
});
