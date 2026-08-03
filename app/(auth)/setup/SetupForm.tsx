'use client';

import { useActionState } from 'react';
import { Card, CardContent, Field, Input, Button, Banner } from '@/components/ui';
import { AuthPlainBackgroundShell, AuthMasthead } from '@/components/governance/AuthPlainBackgroundShell';
import { setupAction, type SetupActionState } from './actions';

const initialState: SetupActionState = {};

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, initialState);

  return (
    <AuthPlainBackgroundShell>
      <AuthMasthead title="Welcome to Forge" subtitle="Create the admin account to get started" />

      <Card elevation="floating">
        <CardContent className="py-6">
          <form action={formAction} className="flex flex-col gap-4">
            <Field label="Display name">
              {(p) => <Input {...p} name="displayName" type="text" autoComplete="name" autoFocus required />}
            </Field>
            <Field label="Username">
              {(p) => <Input {...p} name="username" type="text" autoComplete="username" required />}
            </Field>
            <Field label="Password">
              {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required />}
            </Field>
            <Field label="Confirm password">
              {(p) => <Input {...p} name="confirmPassword" type="password" autoComplete="new-password" required />}
            </Field>
            {state.error ? <Banner variant="danger" title={state.error} /> : null}
            <Button type="submit" loading={pending} className="w-full">
              {pending ? 'Creating account…' : 'Create admin account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthPlainBackgroundShell>
  );
}
