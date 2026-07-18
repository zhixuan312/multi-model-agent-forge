import { render, screen, fireEvent } from '@testing-library/react';
import { StageShell, type StageShellItem } from '@/components/patterns/stage-shell';

const items: StageShellItem[] = [
  { id: '1', label: 'Investigate backend', description: 'Survey config files', status: 'recorded', statusVariant: 'sage' },
  { id: '2', label: 'Research best practices', description: 'Web search', status: 'running', statusVariant: 'amber' },
  { id: '3', label: 'Journal recall', description: 'Prior decisions' },
];

describe('StageShell', () => {
  it('renders list title and items in the rail', () => {
    render(
      <StageShell items={items} activeId="1" onSelect={() => {}} listTitle="Tasks" listProgress="1/3">
        <p>Detail content</p>
      </StageShell>,
    );
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('Investigate backend')).toBeInTheDocument();
    expect(screen.getByText('Research best practices')).toBeInTheDocument();
    expect(screen.getByText('Journal recall')).toBeInTheDocument();
  });

  it('renders detail content in the main area', () => {
    render(
      <StageShell items={items} activeId="1" onSelect={() => {}} listTitle="Tasks">
        <p>Selected task detail</p>
      </StageShell>,
    );
    expect(screen.getByText('Selected task detail')).toBeInTheDocument();
  });

  it('highlights the active item', () => {
    const { container } = render(
      <StageShell items={items} activeId="2" onSelect={() => {}} listTitle="Tasks">
        <p>Detail</p>
      </StageShell>,
    );
    const buttons = container.querySelectorAll('button');
    const activeBtn = Array.from(buttons).find((b) => b.textContent?.includes('Research'));
    expect(activeBtn?.className).toContain('border-accent');
  });

  it('calls onSelect when an item is clicked', () => {
    const onSelect = vi.fn();
    render(
      <StageShell items={items} activeId="1" onSelect={onSelect} listTitle="Tasks">
        <p>Detail</p>
      </StageShell>,
    );
    fireEvent.click(screen.getByText('Research best practices'));
    expect(onSelect).toHaveBeenCalledWith('2');
  });

  it('renders status badges on items that have them', () => {
    render(
      <StageShell items={items} activeId="1" onSelect={() => {}} listTitle="Tasks">
        <p>Detail</p>
      </StageShell>,
    );
    expect(screen.getByText('recorded')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders note at the top of the rail', () => {
    render(
      <StageShell items={items} activeId="1" onSelect={() => {}} listTitle="Tasks" note={<div>Guidance note</div>}>
        <p>Detail</p>
      </StageShell>,
    );
    expect(screen.getByText('Guidance note')).toBeInTheDocument();
  });

  it('renders footer in the rail card', () => {
    render(
      <StageShell items={items} activeId="1" onSelect={() => {}} listTitle="Tasks" footer={<button>Continue</button>}>
        <p>Detail</p>
      </StageShell>,
    );
    expect(screen.getByText('Continue')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(
      <StageShell items={[]} activeId={null} onSelect={() => {}} listTitle="Tasks">
        <p>Detail</p>
      </StageShell>,
    );
    expect(screen.getByText('No items yet.')).toBeInTheDocument();
  });
});
