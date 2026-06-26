import { render, screen } from '@testing-library/react';
import { StatusDashboard } from '@/components/patterns/status-dashboard';

describe('StatusDashboard', () => {
  const metrics = [
    { label: 'Total', value: 5 },
    { label: 'Active', value: 3 },
  ];

  it('renders metrics', () => {
    render(<StatusDashboard metrics={metrics} primary={<p>Table</p>} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders primary content', () => {
    render(<StatusDashboard metrics={metrics} primary={<p>Main content</p>} />);
    expect(screen.getByText('Main content')).toBeInTheDocument();
  });

  it('renders aside content in rail column', () => {
    render(<StatusDashboard metrics={metrics} primary={<p>Main</p>} aside={<p>Rail</p>} />);
    expect(screen.getByText('Rail')).toBeInTheDocument();
  });

  it('renders full-width when no aside', () => {
    const { container } = render(<StatusDashboard metrics={metrics} primary={<p>Main</p>} />);
    expect(container.querySelector('.lg\\:grid-cols-3')).toBeNull();
  });
});
