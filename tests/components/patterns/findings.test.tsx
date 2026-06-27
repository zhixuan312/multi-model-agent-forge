import { render, screen, fireEvent } from '@testing-library/react';
import { SeverityBadge, FindingCard, FindingsGrid, AuditRoundCard, type Finding } from '@/components/patterns/findings';

const finding: Finding = {
  severity: 'high',
  category: 'security',
  claim: 'SQL injection in user input',
  evidence: 'The query string is interpolated directly',
  suggestion: 'Use parameterized queries',
};

describe('SeverityBadge', () => {
  it('renders the severity text', () => {
    render(<SeverityBadge severity="critical" />);
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('applies critical styling', () => {
    const { container } = render(<SeverityBadge severity="critical" />);
    expect(container.firstElementChild!.className).toContain('rose');
  });

  it('applies high styling', () => {
    const { container } = render(<SeverityBadge severity="high" />);
    expect(container.firstElementChild!.className).toContain('amber');
  });
});

describe('FindingCard', () => {
  it('renders claim, evidence, and suggestion', () => {
    render(<FindingCard finding={finding} />);
    expect(screen.getByText('SQL injection in user input')).toBeInTheDocument();
    expect(screen.getByText(/parameterized queries/)).toBeInTheDocument();
  });

  it('renders severity badge', () => {
    render(<FindingCard finding={finding} />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(<FindingCard finding={finding} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('shows index number when provided', () => {
    render(<FindingCard finding={finding} index={0} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('FindingsGrid', () => {
  it('renders findings in a grid', () => {
    render(<FindingsGrid findings={[finding, { ...finding, severity: 'low', claim: 'Minor issue' }]} />);
    expect(screen.getByText('SQL injection in user input')).toBeInTheDocument();
    expect(screen.getByText('Minor issue')).toBeInTheDocument();
  });

  it('calls onApply with all indices when Apply all clicked', () => {
    const onApply = vi.fn();
    render(<FindingsGrid findings={[finding]} selectable onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /apply all/i }));
    expect(onApply).toHaveBeenCalledWith([0]);
  });
});

describe('AuditRoundCard', () => {
  it('renders pass number and verdict', () => {
    render(<AuditRoundCard passNo={1} verdict="revised" findings={[finding]} />);
    expect(screen.getByText('Pass 1')).toBeInTheDocument();
    expect(screen.getByText('revised')).toBeInTheDocument();
  });

  it('shows severity breakdown pills', () => {
    render(<AuditRoundCard passNo={1} verdict="revised" findings={[finding]} />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('shows clean verdict badge', () => {
    render(<AuditRoundCard passNo={2} verdict="clean" findings={[]} />);
    expect(screen.getByText('clean')).toBeInTheDocument();
  });
});

