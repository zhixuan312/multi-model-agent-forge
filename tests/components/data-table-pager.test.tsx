// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, pageWindow } from '@/components/ui/data-table';
import type { ColumnDef } from '@tanstack/react-table';

/**
 * The pager rendered `Array.from({ length: pageCount })` — one button per page. No caller
 * passes `pageSize`, so every paginated table in the app runs at the default 10: 500 rows
 * drew 50 buttons across the footer, 2,000 drew 200. The control degraded exactly as the data
 * it exists to navigate grew.
 */
describe('pageWindow', () => {
  it('shows every page while they all fit', () => {
    expect(pageWindow(0, 1)).toEqual([0]);
    expect(pageWindow(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('always includes the first page, the last page and the current one', () => {
    for (const count of [8, 20, 200]) {
      for (const idx of [0, 1, 4, Math.floor(count / 2), count - 2, count - 1]) {
        const w = pageWindow(idx, count);
        expect(w, `first missing at ${idx}/${count}`).toContain(0);
        expect(w, `last missing at ${idx}/${count}`).toContain(count - 1);
        expect(w, `current missing at ${idx}/${count}`).toContain(idx);
      }
    }
  });

  it('stays bounded however much data arrives — that is the whole point', () => {
    for (const count of [8, 50, 500, 5000]) {
      for (const idx of [0, 7, Math.floor(count / 2), count - 1]) {
        expect(pageWindow(idx, count).length, `${idx}/${count}`).toBeLessThanOrEqual(7);
      }
    }
  });

  it('marks a gap only where numbers are actually skipped', () => {
    // Adjacent to the start: nothing is hidden on the left.
    expect(pageWindow(0, 20)).toEqual([0, 1, 'gap', 19]);
    expect(pageWindow(19, 20)).toEqual([0, 'gap', 18, 19]);
    expect(pageWindow(9, 20)).toEqual([0, 'gap', 8, 9, 10, 'gap', 19]);
  });

  it('never emits a gap that hides nothing', () => {
    for (const count of [8, 9, 12, 40]) {
      for (let idx = 0; idx < count; idx++) {
        const w = pageWindow(idx, count);
        for (let i = 1; i < w.length - 1; i++) {
          if (w[i] !== 'gap') continue;
          const before = w[i - 1] as number;
          const after = w[i + 1] as number;
          expect(after - before, `useless gap between ${before} and ${after}`).toBeGreaterThan(1);
        }
      }
    }
  });
});

interface Row { id: string }
const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: 'id', header: 'Id' }];

describe('DataTable footer', () => {
  it('draws a bounded pager for a large table', () => {
    const data = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }));
    render(<DataTable columns={columns} data={data} />);

    const pages = screen.getAllByRole('button', { name: /^Page \d+$/ });
    expect(pages.length).toBeLessThanOrEqual(7);
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 50' })).toBeInTheDocument();
  });

  it('says there are no rows rather than "Showing 0–0 of 0"', () => {
    render(<DataTable columns={columns} data={[]} emptyState={<p>Nothing here</p>} />);
    expect(screen.getByText('No rows')).toBeInTheDocument();
    expect(screen.queryByText(/Showing 0/)).toBeNull();
  });
});
