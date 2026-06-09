'use client';

import { useActionState } from 'react';
import { loginAction, type LoginActionState } from './actions';

const initialState: LoginActionState = {};

/**
 * Login screen — username + password. The only route reachable unauthenticated.
 * Submits to the `loginAction` server action (rate-limit → authenticate →
 * session cookie → redirect to `/`).
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Forge</h1>
          <p className="mt-1 font-mono text-xs text-ink-faint">Sign in to continue</p>
        </div>

        <form action={formAction} className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
          <div className="space-y-1">
            <label htmlFor="username" className="block text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-line-strong focus:ring-2 focus:ring-line-strong/40"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-line-strong focus:ring-2 focus:ring-line-strong/40"
            />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-rose">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-deep disabled:opacity-60"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
