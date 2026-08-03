import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { statusStyle, opStyle } from '@/components/forge/journal/palette';
import { resolveCitations, UNKNOWN_NODE_TITLE } from '@/journal/citations';
import { StatusBadge, StatusDot } from '@/components/forge/journal/StatusBadge';

describe('journal palette', () => {
  it('binds every status, and falls back to neutral without throwing', () => {
    for (const s of ['adopted', 'superseded', 'inconclusive', 'dropped']) {
      expect(statusStyle(s).label).toBe(s);
      expect(statusStyle(s).cls).not.toBe('');
    }
    expect(statusStyle('wat').label).toBe('wat');
    expect(statusStyle('').label).toBe('unknown');
  });

  it('binds every write-log op, with a neutral fallback', () => {
    for (const op of ['create', 'refine', 'supersede', 'merge']) {
      expect(opStyle(op).cls).not.toBe('');
    }
    expect(opStyle('nope').cls).toContain('text-ink-soft');
  });

  /**
   * steel and ember were declared as raw variables but never exposed to `@theme`, so
   * every utility naming them emitted no CSS. `tests/distribution/design-tokens.test.ts`
   * is the general guard; these two are the chips that were actually broken.
   */
  it('styles inconclusive and refine with the families that were missing', () => {
    expect(statusStyle('inconclusive').cls).toContain('text-steel-deep');
    expect(opStyle('refine').cls).toContain('bg-ember-tint');
  });
});

/**
 * `resolveCitations` produced `'(unknown node)'` and `RecallView` compared against that
 * literal to italicise the row — two modules, one string, nothing keeping them in step.
 */
describe('unknown-citation sentinel', () => {
  it('is the same value the resolver emits and the view tests for', () => {
    const rows = resolveCitations(['9999'], [{ id: '0001', title: 'Known', status: 'adopted' }]);
    expect(rows[0]!.title).toBe(UNKNOWN_NODE_TITLE);
    expect(rows[0]!.status).toBeNull();
  });

  it('leaves a resolvable citation alone', () => {
    const rows = resolveCitations(['0001'], [{ id: '0001', title: 'Known', status: 'adopted' }]);
    expect(rows[0]).toEqual({ id: '0001', title: 'Known', status: 'adopted' });
  });
});

describe('StatusDot', () => {
  /**
   * `role="status"` is a live region. Recall renders one dot per result row, so a
   * search made every row its own polite announcer. A dot is a graphic that carries
   * meaning — `img` plus a label.
   */
  it('is a labelled image, not a live region', () => {
    render(<StatusDot status="adopted" />);
    expect(screen.getByRole('img', { name: 'status: adopted' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('labels an unrecognised status with the raw value rather than dropping it', () => {
    render(<StatusDot status="mystery" />);
    expect(screen.getByRole('img', { name: 'status: mystery' })).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('carries the status TEXT, never colour alone', () => {
    render(<StatusBadge status="superseded" />);
    expect(screen.getByText('superseded')).toBeInTheDocument();
  });
});
