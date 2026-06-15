'use client';

import { Fragment, type ReactNode, useState } from 'react';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Micro } from '@/components/ui/typography';

/**
 * DataTable — the Forge data grid, driven by TanStack Table. Standard shadcn
 * pattern: a fixed `pageSize`, consistent row heights, and a pager — no internal
 * scroll and no viewport math. Pass `ColumnDef`s with `size` for fixed widths;
 * leave a column's `size` unset to let it flex.
 *
 * `fill` mode (opt-in): show ALL rows and scroll internally with a sticky header,
 * filling the parent's height instead of paginating. Use inside a flex/`fill`
 * page so the table reaches the page bottom (like the Journal tabs).
 */
export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pageSize?: number;
  /** Show all rows and scroll internally (sticky header), filling the parent. */
  fill?: boolean;
  emptyState?: ReactNode;
  /** Stable domain id for a row — required for inline expansion. */
  getRowId?: (row: TData) => string;
  /** The row (by `getRowId`) whose inline editor panel is open, if any. */
  expandedId?: string | null;
  /** Inline editor panel rendered full-width directly beneath the expanded row. */
  renderExpanded?: (row: TData) => ReactNode;
  /** Optional panel rendered above all rows (e.g. an inline "add new" form). */
  leadingRow?: ReactNode;
  /** data-testid forwarded to the <table> (for existing tests). */
  'data-testid'?: string;
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pageSize = 10,
  fill = false,
  emptyState,
  getRowId,
  expandedId,
  renderExpanded,
  leadingRow,
  className,
  'data-testid': testId,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  // In fill mode show every row (no pagination) — the body scrolls instead.
  const effectivePageSize = fill ? 100_000 : pageSize;
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: effectivePageSize } },
  });

  const rows = table.getRowModel().rows;
  const total = table.getRowCount();
  const pageCount = table.getPageCount();
  const { pageIndex, pageSize: ps } = table.getState().pagination;
  const start = pageIndex * ps;
  const colCount = table.getVisibleLeafColumns().length;
  const showTable = data.length > 0 || leadingRow != null;

  const body = (
    <Table className="table-fixed" data-testid={testId}>
      <TableHeader className={fill ? 'sticky top-0 z-10 [&_th]:border-b [&_th]:border-line [&_th]:bg-surface' : undefined}>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  const w = h.column.columnDef.size;
                  return (
                    <TableHead
                      key={h.id}
                      style={w ? { width: w } : undefined}
                      className={cn(sortable && 'cursor-pointer select-none')}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sortable ? (
                          sorted === 'asc' ? (
                            <ChevronUp className="size-3" aria-hidden />
                          ) : sorted === 'desc' ? (
                            <ChevronDown className="size-3" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                          )
                        ) : null}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {leadingRow ? (
              <tr>
                <td colSpan={colCount} className="border-b border-line/70 p-0">
                  {leadingRow}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const id = getRowId?.(row.original);
              const isExpanded = id != null && id === expandedId;
              return (
                <Fragment key={row.id}>
                  <TableRow
                    data-testid="data-row"
                    data-state={isExpanded ? 'selected' : undefined}
                    className="h-[57px]"
                  >
                    {row.getVisibleCells().map((cell) => {
                      const w = cell.column.columnDef.size;
                      return (
                        <TableCell key={cell.id} style={w ? { width: w } : undefined}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {isExpanded && renderExpanded ? (
                    <tr>
                      <td colSpan={colCount} className="border-b border-line/70 bg-surface-2/50 p-0">
                        {renderExpanded(row.original)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
    </Table>
  );

  return (
    <div className={cn('flex flex-col', fill && 'min-h-0 flex-1', className)}>
      {!showTable ? (
        <div className={cn('grid place-items-center p-10', fill && 'min-h-0 flex-1')}>{emptyState}</div>
      ) : fill ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      ) : (
        body
      )}

      <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
        <Micro>
          Showing {total === 0 ? 0 : start + 1}–{Math.min(start + ps, total)} of {total}
        </Micro>
        {pageCount > 1 ? (
          <nav className="flex items-center gap-1" aria-label="Pagination">
            <PagerButton
              label="Previous page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ChevronLeft aria-hidden />
            </PagerButton>
            {Array.from({ length: pageCount }, (_, i) => i).map((i) => (
              <button
                key={i}
                type="button"
                aria-current={i === pageIndex ? 'page' : undefined}
                onClick={() => table.setPageIndex(i)}
                className={cn(
                  'focus-ring grid size-7 place-items-center rounded-[var(--r-sm)] border text-xs font-medium transition-colors',
                  i === pageIndex ? 'border-accent text-accent' : 'border-line text-ink-soft hover:border-line-strong',
                )}
              >
                {i + 1}
              </button>
            ))}
            <PagerButton
              label="Next page"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              <ChevronRight aria-hidden />
            </PagerButton>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="focus-ring grid size-7 place-items-center rounded-[var(--r-sm)] border border-line text-ink-soft transition-colors hover:border-line-strong disabled:opacity-40 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
