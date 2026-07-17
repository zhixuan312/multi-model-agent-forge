import { render, screen } from '@testing-library/react';
import { LoginForm } from '../../app/(auth)/login/LoginForm';
import { SetupForm } from '../../app/(auth)/setup/SetupForm';

vi.mock('../../app/(auth)/login/actions', () => ({
  loginAction: vi.fn(),
}));

vi.mock('../../app/(auth)/setup/actions', () => ({
  setupAction: vi.fn(),
}));

describe('auth forms shell wiring', () => {
  it('login and setup render through the shared auth shell wrapper', () => {
    const { container: login } = render(<LoginForm />);
    const { container: setup } = render(<SetupForm />);
    expect(login.querySelector('main')).toHaveClass('app-bg', 'px-4', 'py-10');
    expect(setup.querySelector('main')).toHaveClass('app-bg', 'px-4', 'py-10');
    expect(screen.getByText('Forge')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Forge')).toBeInTheDocument();
  });
});
