import { render, screen } from '@testing-library/react';
import { RailNote } from '@/components/patterns/feature-rail';

describe('RailNote', () => {
  it('renders the icon in a tinted circle', () => {
    render(<RailNote icon={<svg data-testid="icon" />}>Content</RailNote>);
    const icon = screen.getByTestId('icon');
    expect(icon.closest('[aria-hidden]')).toBeInTheDocument();
  });

  it('renders markdown content', () => {
    render(<RailNote icon={<svg />}>**bold**</RailNote>);
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders an optional title', () => {
    render(<RailNote icon={<svg />} title="Access">Content</RailNote>);
    expect(screen.getByText('Access')).toBeInTheDocument();
  });
});
