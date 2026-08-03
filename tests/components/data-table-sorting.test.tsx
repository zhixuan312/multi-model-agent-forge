import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';

interface Row { name: string; n: number }
const data: Row[] = [{ name: 'Bo', n: 2 }, { name: 'Ada', n: 1 }, { name: 'Cy', n: 3 }];
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name', cell: ({ row }) => row.original.name },
  { accessorKey: 'n', header: 'Count', enableSorting: false, cell: ({ row }) => row.original.n },
];

const names = () => screen.getAllByTestId('data-row').map((r) => within(r).getAllByRole('cell')[0].textContent);

/**
 * Sorting used to be an `onClick` on the `<th>`: no focus stop, no Enter/Space, no
 * accessible name, and no `aria-sort`. Every table in the app was therefore sortable only
 * with a mouse, and the sort state was carried purely by a chevron glyph.
 */
describe('DataTable sorting is reachable and announced', () => {
  it('exposes a sortable column as a real button, so it is focusable and keyboard-operable', () => {
    render(<DataTable columns={columns} data={data} />);
    const header = screen.getByRole('button', { name: /Name/ });
    expect(header).toBeInTheDocument();

    header.focus();
    expect(header).toHaveFocus(); // a <th onClick> could not be focused at all
  });

  it('sorts on Enter, not only on click', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(names()).toEqual(['Bo', 'Ada', 'Cy']);
    // fireEvent.click is what a keyboard Enter dispatches on a real <button>.
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(names()).toEqual(['Ada', 'Bo', 'Cy']);
  });

  it('announces the sort state through aria-sort, cycling none → ascending → descending', () => {
    render(<DataTable columns={columns} data={data} />);
    const th = () => screen.getByRole('columnheader', { name: /Name/ });
    expect(th()).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(th()).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(th()).toHaveAttribute('aria-sort', 'descending');
  });

  it('leaves a non-sortable column as plain header text — no button, no aria-sort', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.queryByRole('button', { name: /Count/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Count/ })).not.toHaveAttribute('aria-sort');
  });
});
