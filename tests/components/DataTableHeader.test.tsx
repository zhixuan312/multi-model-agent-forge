import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTableHeader } from '@/components/ui/data-table';

/**
 * This shell was written out verbatim in SEVEN places — Members, Workspace, Loops and the
 * four Usage tables — each spelling the same
 * `flex shrink-0 flex-col gap-4 border-b border-line p-5` and the same title/action row.
 * The governance catalog already named the affordances (`header`, `primaryAction`,
 * `toolbar`); they are props now rather than a convention seven files had to remember.
 */
describe('DataTableHeader', () => {
  it('renders the title and the toolbar passed as children', () => {
    render(<DataTableHeader title="Team members"><div>toolbar here</div></DataTableHeader>);
    expect(screen.getByText('Team members')).toBeInTheDocument();
    expect(screen.getByText('toolbar here')).toBeInTheDocument();
  });

  it('puts a primary action on the title row', () => {
    const { container } = render(
      <DataTableHeader title="Loops" action={<button type="button">New loop</button>} />,
    );
    expect(screen.getByRole('button', { name: 'New loop' })).toBeInTheDocument();
    expect(container.querySelector('.justify-between')).not.toBeNull();
  });

  /**
   * Three of the seven tables have no primary action, and Workspace drops its own for a
   * non-admin. Rendering the row regardless would leave an empty flex container that
   * shifts the title.
   */
  it('omits the title ROW entirely when there is no action', () => {
    const { container } = render(<DataTableHeader title="Loop costs" />);
    expect(container.querySelector('.justify-between')).toBeNull();
    expect(screen.getByText('Loop costs')).toBeInTheDocument();
  });

  it('treats a null action the same as none — the non-admin Workspace case', () => {
    const { container } = render(<DataTableHeader title="Repositories" action={null} />);
    expect(container.querySelector('.justify-between')).toBeNull();
  });

  /**
   * The governance catalog declares `header` a toggleable affordance, and its Table
   * preview switches the title off — which is why the preview forked its own copy of this
   * shell rather than using the component it exists to demonstrate.
   */
  it('renders an action with no title, keeping it right-aligned', () => {
    const { container } = render(<DataTableHeader action={<button type="button">New item</button>} />);
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument();
    expect(container.querySelector('.justify-between')).not.toBeNull();
  });

  it('renders nothing but the toolbar when neither title nor action is given', () => {
    render(<DataTableHeader><div>toolbar only</div></DataTableHeader>);
    expect(screen.getByText('toolbar only')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
