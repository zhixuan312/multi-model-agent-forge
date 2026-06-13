'use client';

import { useActionState } from 'react';
import { Card, CardContent, Display, Micro, Field, Input, Button, Banner } from '@/components/ui';
import { ForgeMark } from '@/components/forge/ForgeMark';
import { setupAction, type SetupActionState } from './actions';

const initialState: SetupActionState = {};

/**
 * First-run admin registration form — display name + username + password +
 * confirmation. Submits to the `setupAction` server action, which creates the
 * one admin and redirects to `/login`. Rendered by the `/setup` server
 * component only while the team has zero members.
 */
export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAction, initialState);

  return (
    <main className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-bg px-4 py-10 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <ForgeMark className="mb-3 scale-125" />
          <Display className="!text-4xl">Welcome to Forge</Display>
          <Micro className="mt-1.5 block">Create the admin account to get started</Micro>
        </div>

        <Card elevation="floating">
          <CardContent className="py-6">
            <form action={formAction} className="flex flex-col gap-4">
              <Field label="Display name">
                {(p) => (
                  <Input
                    {...p}
                    name="displayName"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    required
                  />
                )}
              </Field>

              <Field label="Username">
                {(p) => (
                  <Input
                    {...p}
                    name="username"
                    type="text"
                    autoComplete="username"
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
                    autoComplete="new-password"
                    required
                  />
                )}
              </Field>

              <Field label="Confirm password">
                {(p) => (
                  <Input
                    {...p}
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                )}
              </Field>

              {state.error ? <Banner variant="danger" title={state.error} /> : null}

              <Button type="submit" loading={pending} className="w-full">
                {pending ? 'Creating account…' : 'Create admin account'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
