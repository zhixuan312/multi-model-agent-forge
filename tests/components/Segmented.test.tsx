// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Segmented } from '@/components/ui/segmented';

/**
 * There were two near-identical copies of this control: one private to the Models panel
 * and one exported from `LoopForm` that nobody imported. They rendered the same markup,
 * but only the Loop copy carried the accessibility attributes — the Models copy shipped a
 * radiogroup with no accessible name.
 *
 * Consolidating them is only half the fix; these lock the half that is easy to lose again.
 * The accessible-name assertion is the whole reason `label` is a REQUIRED prop, so it is
 * asserted through the a11y tree (`getByRole(..., { name })`) rather than by reading the
 * `aria-label` attribute back — the attribute being present is not the same claim as the
 * group actually being announced with that name.
 */
const OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'complex', label: 'Complex' },
];

describe('Segmented', () => {
  it('exposes a radiogroup carrying the accessible name from `label`', () => {
    render(<Segmented value="standard" onChange={() => {}} options={OPTIONS} label="Worker tier" />);
    expect(screen.getByRole('radiogroup', { name: 'Worker tier' })).toBeInTheDocument();
  });

  it('renders one radio per option and marks ONLY the selected one checked', () => {
    render(<Segmented value="complex" onChange={() => {}} options={OPTIONS} label="Worker tier" />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Complex' })).toHaveAttribute('aria-checked', 'true');
  });

  it('reports the clicked option value to onChange', async () => {
    const onChange = vi.fn();
    render(<Segmented value="standard" onChange={onChange} options={OPTIONS} label="Worker tier" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Complex' }));
    expect(onChange).toHaveBeenCalledWith('complex');
  });

  it('is a controlled component — clicking does not change what is rendered on its own', async () => {
    render(<Segmented value="standard" onChange={() => {}} options={OPTIONS} label="Worker tier" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Complex' }));
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not submit an enclosing form (the buttons are type=button)', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Segmented value="standard" onChange={() => {}} options={OPTIONS} label="Worker tier" />
      </form>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Complex' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
