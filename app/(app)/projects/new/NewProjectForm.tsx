'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { Globe, Lock, ArrowRight } from 'lucide-react';
import { Card, CardContent, Input, Button, Label, Micro } from '@/components/ui';
import { RepoPicker, type RepoPickerRepo } from '@/components/forge/RepoPicker';
import { createProjectAction, type NewProjectState } from './actions';

/**
 * New-project client form (Spec 3 flow 1). Accessible: every control is labelled;
 * visibility is a labelled radio group exposing selected state; field-level
 * validation errors are associated via `aria-describedby` AND announced in an
 * `aria-live="polite"` region. Selected repo ids are submitted as hidden
 * `repoIds` inputs alongside the server action.
 */
export function NewProjectForm({ repos }: { repos: RepoPickerRepo[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState<NewProjectState, FormData>(
    createProjectAction,
    {},
  );

  const nameError = state.error?.field === 'name' ? state.error.message : null;
  const repoError = state.error?.field === 'repoIds' ? state.error.message : null;

  return (
    <form action={formAction} className="max-w-2xl">
      {/* selected repo ids ride along as hidden fields */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="repoIds" value={id} />
      ))}

      <Card>
        <CardContent className="flex flex-col gap-6 py-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              name="name"
              aria-describedby={nameError ? 'name-error' : undefined}
              aria-invalid={nameError ? true : undefined}
            />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <Label as="legend">Visibility</Label>
            <div role="radiogroup" aria-label="Visibility" className="flex gap-5 t-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="visibility" value="public" defaultChecked className="size-4 accent-[var(--accent)]" />
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <Globe className="size-4 text-ink-soft" aria-hidden /> Public
                </span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="visibility" value="private" className="size-4 accent-[var(--accent)]" />
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <Lock className="size-4 text-ink-soft" aria-hidden /> Private
                </span>
              </label>
            </div>
            <Micro>Private hides this project&apos;s work artifacts, not code.</Micro>
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label as="span">Repositories</Label>
            <RepoPicker repos={repos} selected={selected} onChange={setSelected} />
          </div>
        </CardContent>
      </Card>

      {/* a11y: validation errors are announced politely */}
      <div aria-live="polite">
        {nameError ? (
          <Micro id="name-error" role="alert" className="mt-2 block text-rose">
            {nameError}
          </Micro>
        ) : null}
        {repoError ? (
          <Micro id="repos-error" role="alert" className="mt-2 block text-rose">
            {repoError}
          </Micro>
        ) : null}
      </div>

      <div className="mt-5 flex items-center justify-end">
        <Button type="submit" loading={pending} rightIcon={<ArrowRight />}>
          {pending ? 'Creating…' : 'Create & start exploration'}
        </Button>
      </div>
    </form>
  );
}
