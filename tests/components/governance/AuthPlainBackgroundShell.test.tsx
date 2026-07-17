import { render, screen } from '@testing-library/react';
import { AuthPlainBackgroundShell } from '@/components/governance/AuthPlainBackgroundShell';

describe('auth plain background shell', () => {
  it('renders the shared auth shell wrapper markup', () => {
    const { container } = render(
      <AuthPlainBackgroundShell>
        <div>Auth content</div>
      </AuthPlainBackgroundShell>,
    );
    const main = container.querySelector('main');
    expect(main).toHaveClass('app-bg', 'flex', 'h-full', 'min-h-0', 'flex-col', 'items-center', 'justify-center', 'overflow-y-auto', 'px-4', 'py-10', 'text-ink');
    expect(screen.getByText('Auth content')).toBeInTheDocument();
  });
});
