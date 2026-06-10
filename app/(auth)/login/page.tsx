'use client';

import { useActionState } from 'react';
import { Card, CardContent, Display, Micro, Field, Input, Button, Banner } from '@/components/ui';
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
          <Display className="!text-4xl">Forge</Display>
          <Micro className="mt-1.5 block">Sign in to continue</Micro>
        </div>

        <Card elevation="floating">
          <CardContent className="py-6">
            <form action={formAction} className="flex flex-col gap-4">
              <Field label="Username">
                {(p) => (
                  <Input
                    {...p}
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    required
                  />
                )}
              </Field>

              <Field label="Password">
                {(p) => (
                  <Input
                    {...p}
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                )}
              </Field>

              {state.error ? <Banner variant="danger" title={state.error} /> : null}

              <Button type="submit" loading={pending} className="w-full">
                {pending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
