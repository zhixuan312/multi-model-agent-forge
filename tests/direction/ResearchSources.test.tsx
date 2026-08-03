import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResearchSources } from '@/components/direction/ResearchSources';
import { RESEARCH_SOURCES } from '@/content/direction-reference';

/**
 * "Open" used to be the literal '—' stored in the DATA and compared against in the VIEW —
 * one string, two modules, nothing keeping them in step. The placeholder glyph is a view
 * choice; the data says `null`.
 */
describe('ResearchSources', () => {
  it('lists every source with what it covers', () => {
    render(<ResearchSources />);
    expect(RESEARCH_SOURCES.length).toBeGreaterThan(3);
    for (const s of RESEARCH_SOURCES) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it('renders a dash for an open source and the requirement for a gated one', () => {
    render(<ResearchSources />);
    const open = RESEARCH_SOURCES.filter((s) => s.auth === null);
    const gated = RESEARCH_SOURCES.filter((s) => s.auth !== null);
    expect(open.length).toBeGreaterThan(0);
    expect(gated.length).toBeGreaterThan(0);
    expect(screen.getAllByText('—')).toHaveLength(open.length);
    for (const s of gated) expect(screen.getByText(s.auth!)).toBeInTheDocument();
  });

  it('keeps the placeholder out of the data', () => {
    for (const s of RESEARCH_SOURCES) expect(s.auth).not.toBe('—');
  });
});
