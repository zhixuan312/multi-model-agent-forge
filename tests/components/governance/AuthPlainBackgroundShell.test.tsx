import { render, screen } from '@testing-library/react';
import { GOVERNANCE_REGISTRY } from '@/components/governance/registry';
import { AuthPlainBackgroundShell } from '@/components/governance/AuthPlainBackgroundShell';

describe('auth plain background shell', () => {
  it('registers the extracted auth shell as the canonical authPlainBackground slot', () => {
    const entry = GOVERNANCE_REGISTRY.authPlainBackground;
    expect(entry.canonicalComponent).toBe('AuthPlainBackgroundShell');
    expect(entry.canonicalFilePath).toBe('src/components/governance/AuthPlainBackgroundShell.tsx');
    expect(entry.consumers).toEqual([
      { id: 'login', label: 'Login Form', filePath: 'app/(auth)/login/LoginForm.tsx' },
      { id: 'setup', label: 'Setup Form', filePath: 'app/(auth)/setup/SetupForm.tsx' },
    ]);
  });

  it('renders the shared auth shell wrapper markup', () => {
    const { container } = render(
      <AuthPlainBackgroundShell>
        <div>Auth content</div>
      </AuthPlainBackgroundShell>,
    );
    const main = container.querySelector('main');
    expect(main).toHaveClass('flex', 'h-full', 'min-h-0', 'flex-col', 'items-center', 'justify-center', 'overflow-y-auto', 'bg-bg', 'px-4', 'py-10', 'text-ink');
    expect(screen.getByText('Auth content')).toBeInTheDocument();
  });
});
