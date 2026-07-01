'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { ArrowRight, Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardFooter, Input, Button, Field, FieldGrid, Micro } from '@/components/ui';
import { RepoPicker, type RepoPickerRepo } from '@/components/forge/RepoPicker';
import { createProjectAction, type NewProjectState } from './actions';

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', icon: Globe, hint: 'Visible to the whole team' },
  { value: 'private', label: 'Private', icon: Lock, hint: 'Hides work artifacts, not code' },
] as const;

export function NewProjectForm({ repos }: { repos: RepoPickerRepo[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [visibility, setVisibility] = useState('public');
  const [state, formAction, pending] = useActionState<NewProjectState, FormData>(
    createProjectAction,
    {},
  );

  const nameError = state.error?.field === 'name' ? state.error.message : null;
  const repoError = state.error?.field === 'repoIds' ? state.error.message : null;
  const activeVis = VISIBILITY_OPTIONS.find((o) => o.value === visibility)!;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      {selected.map((id) => (
        <input key={id} type="hidden" name="repoIds" value={id} />
      ))}
      <input type="hidden" name="visibility" value={visibility} />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex flex-col gap-5">
          <FieldGrid cols={2}>
            <Field label="Name" error={nameError ?? undefined}>
              {(p) => (
                <Input
                  {...p}
                  name="name"
                  placeholder="e.g. Unified Task API"
                  autoFocus
                />
              )}
            </Field>

            <Field label="Visibility" hint={activeVis.hint}>
              {() => (
                <div
                  role="radiogroup"
                  aria-label="Visibility"
                  className="inline-flex w-fit rounded-[var(--r-md)] border border-line bg-surface p-0.5"
                >
                  {VISIBILITY_OPTIONS.map((o) => {
                    const Icon = o.icon;
                    const active = visibility === o.value;
                    return (
                      <label
                        key={o.value}
                        className={cn(
                          'focus-within:focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-[calc(var(--r-md)-2px)] px-3 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-accent-tint font-medium text-accent-deep'
                            : 'text-ink-soft hover:text-ink',
                        )}
                      >
                        <input
                          type="radio"
                          name="visibility-choice"
                          value={o.value}
                          checked={active}
                          onChange={() => setVisibility(o.value)}
                          className="sr-only"
                        />
                        <Icon className="size-3.5" aria-hidden />
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </Field>
          </FieldGrid>

          <RepoPicker repos={repos} selected={selected} onChange={setSelected} />
          {repoError ? <Micro role="alert" className="text-rose">{repoError}</Micro> : null}
        </CardContent>

        <CardFooter className="mt-auto flex items-center justify-end">
          <Button type="submit" loading={pending} rightIcon={<ArrowRight />}>
            {pending ? 'Creating…' : 'Create & start exploration'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
