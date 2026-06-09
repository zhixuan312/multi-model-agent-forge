import { render, screen, fireEvent } from '@testing-library/react';
import { ModelCombobox } from '../../app/(app)/settings/roster/ModelCombobox';

const suggestions = [
  { provider: 'anthropic', prefix: 'claude-opus', bestFor: 'high-ambiguity tasks' },
  { provider: 'openai', prefix: 'gpt-5', bestFor: null },
];

describe('ModelCombobox', () => {
  it('renders an accessible combobox with a programmatic label', () => {
    render(
      <ModelCombobox id="model-x" label="Model" value="" onChange={() => {}} suggestions={suggestions} catalogAvailable />,
    );
    const input = screen.getByLabelText(/Model/) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    // bound to a datalist (suggestions present)
    expect(input.getAttribute('list')).toBeTruthy();
  });

  it('accepts a free-text custom id (combobox, not a closed select)', () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox id="model-y" label="Model" value="" onChange={onChange} suggestions={suggestions} catalogAvailable />,
    );
    fireEvent.change(screen.getByLabelText(/Model/), { target: { value: 'claude-opus-4-8-custom' } });
    expect(onChange).toHaveBeenCalledWith('claude-opus-4-8-custom');
  });

  it('degrades to free-text with a notice when the catalog is unavailable', () => {
    render(
      <ModelCombobox id="model-z" label="Model" value="" onChange={() => {}} suggestions={[]} catalogAvailable={false} />,
    );
    const input = screen.getByLabelText(/Model/) as HTMLInputElement;
    expect(input.getAttribute('list')).toBeNull(); // no datalist
    expect(screen.getByText(/catalog unavailable/i)).toBeInTheDocument();
  });
});
