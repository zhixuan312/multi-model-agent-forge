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
  it('renders claim and severity badge', () => {
    render(<FindingCard finding={finding} />);
    expect(screen.getByText('SQL injection in user input')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders category label', () => {
    render(<FindingCard finding={finding} />);
    expect(screen.getByText('security')).toBeInTheDocument();
  });

  it('hides evidence and suggestion until the row is expanded', () => {
    render(<FindingCard finding={finding} />);
    expect(screen.queryByText(/interpolated directly/)).not.toBeInTheDocument();
    expect(screen.queryByText(/parameterized queries/)).not.toBeInTheDocument();
  });

  it('shows BOTH evidence and suggestion after expanding', () => {
    // Was named "shows evidence" but only asserted the SUGGESTION, so the evidence line
    // was never actually covered.
    render(<FindingCard finding={finding} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show finding details' }));
    expect(screen.getByText(/interpolated directly/)).toBeInTheDocument();
    expect(screen.getByText(/parameterized queries/)).toBeInTheDocument();
  });

  it('the icon-only expand toggle carries an accessible name and state', () => {
    // It renders a bare chevron. Selecting it used to require `{ name: '' }` — which is
    // the test admitting a screen reader would announce an unlabelled "button".
    render(<FindingCard finding={finding} />);
    const toggle = screen.getByRole('button', { name: 'Show finding details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const open = screen.getByRole('button', { name: 'Hide finding details' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows index number when provided and not selected', () => {
    render(<FindingCard finding={finding} index={0} onSelect={() => {}} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('FindingsGrid (read-only display — selection was removed as the apply effect re-fixes the whole pass)', () => {
  it('renders findings in a grid', () => {
    render(<FindingsGrid findings={[finding, { ...finding, severity: 'low', claim: 'Minor issue' }]} />);
    expect(screen.getByText('SQL injection in user input')).toBeInTheDocument();
    expect(screen.getByText('Minor issue')).toBeInTheDocument();
  });

  it('renders an empty state when there are no findings', () => {
    render(<FindingsGrid findings={[]} />);
    expect(screen.getByText('No findings.')).toBeInTheDocument();
  });

  it('renders no selection checkboxes or apply controls', () => {
    render(<FindingsGrid findings={[finding]} />);
    expect(screen.queryByRole('button', { name: /select all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });
});

describe('AuditRoundCard', () => {
  it('renders pass number and severity pills (no verdict badge for non-clean)', () => {
    render(<AuditRoundCard passNo={1} verdict="revised" findings={[finding]} />);
    expect(screen.getByText('Pass 1')).toBeInTheDocument();
    expect(screen.getByText(/high/)).toBeInTheDocument();
  });

  it('shows clean verdict badge', () => {
    render(<AuditRoundCard passNo={2} verdict="clean" findings={[]} />);
    expect(screen.getByText('clean')).toBeInTheDocument();
  });

  it('shows active styling when active prop is true', () => {
    const { container } = render(<AuditRoundCard passNo={1} verdict="revised" findings={[finding]} active />);
    expect(container.innerHTML).toContain('accent');
  });
});
