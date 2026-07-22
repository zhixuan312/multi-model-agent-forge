'use client';

import { useActionState } from 'react';
import { Card, CardContent, Display, Micro, Field, Input, Button, Banner } from '@/components/ui';
import { ForgeMark } from '@/components/forge/ForgeMark';
import { AuthPlainBackgroundShell } from '@/components/governance/AuthPlainBackgroundShell';
import { loginAction, type LoginActionState } from './actions';

const initialState: LoginActionState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <AuthPlainBackgroundShell>
      <div className="mb-8 flex flex-col items-center text-center">
        <ForgeMark className="mb-3 scale-125" />
        <Display className="!text-4xl">Forge</Display>
        <Micro className="mt-1.5 block">Sign in to continue</Micro>
      </div>

      <Card elevation="floating">
        <CardContent className="py-6">
          <form action={formAction} className="flex flex-col gap-4">
            <Field label="Username">
              {(p) => <Input {...p} name="username" type="text" autoComplete="username" autoFocus required />}
            </Field>
            <Field label="Password">
              {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
            </Field>
            {state.error ? (
              <Banner
                variant="danger"
                title={state.retryAfterSeconds ? `${state.error} Try again in ${state.retryAfterSeconds}s.` : state.error}
              />
            ) : null}
            <Button type="submit" loading={pending} className="w-full">
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthPlainBackgroundShell>
  );
}
