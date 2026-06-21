'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { ArrowRight, Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, Input, Button, Label, Micro, Title } from '@/components/ui';
import { RepoPicker, type RepoPickerRepo } from '@/components/forge/RepoPicker';
import { createProjectAction, type NewProjectState } from './actions';

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', icon: Globe },
  { value: 'private', label: 'Private', icon: Lock },
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

  return (
    <form action={formAction}>
      {selected.map((id) => (
        <input key={id} type="hidden" name="repoIds" value={id} />
      ))}
      <input type="hidden" name="visibility" value={visibility} />

      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line p-5">
          <Title className="!text-lg">Project details</Title>
          <Button type="submit" loading={pending} size="sm" rightIcon={<ArrowRight />}>
            {pending ? 'Creating…' : 'Create & start exploration'}
          </Button>
        </div>

        <div className="flex flex-col p-5">
          {/* Row 1 — identity: name + visibility side by side */}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                name="name"
                placeholder="e.g. Unified Task API"
                aria-describedby={nameError ? 'name-error' : undefined}
                aria-invalid={nameError ? true : undefined}
              />
              {nameError ? (
                <Micro id="name-error" role="alert" className="text-rose">{nameError}</Micro>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col gap-1.5">
              <Label as="span">Visibility</Label>
              <div
                role="radiogroup"
                aria-label="Visibility"
                className="inline-flex w-fit rounded-[var(--r-md)] border border-line bg-surface p-0.5"
              >
                {VISIBILITY_OPTIONS.map((o) => {
                  const Icon = o.icon;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={visibility === o.value}
                      onClick={() => setVisibility(o.value)}
                      className={cn(
                        'focus-ring inline-flex items-center gap-1.5 rounded-[calc(var(--r-md)-2px)] px-3 py-1.5 text-sm transition-colors',
                        visibility === o.value
                          ? 'bg-accent-tint font-medium text-accent-deep'
                          : 'text-ink-soft hover:text-ink',
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <Micro className="text-ink-faint">
                {visibility === 'private' ? 'Hides work artifacts, not code' : 'Visible to the whole team'}
              </Micro>
            </div>
          </div>

          {/* Divider */}
          <div className="my-5 border-t border-line" />

          {/* Row 2 — scope: repositories */}
          <div className="flex flex-col gap-2">
            <Label as="span">Repositories</Label>
            <RepoPicker repos={repos} selected={selected} onChange={setSelected} />
            {repoError ? (
              <Micro id="repos-error" role="alert" className="text-rose">{repoError}</Micro>
            ) : null}
          </div>
        </div>
      </Card>
    </form>
  );
}
