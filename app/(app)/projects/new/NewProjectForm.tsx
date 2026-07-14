'use client';

import { useActionState, useMemo, useState } from 'react';
import { ArrowRight, Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardFooter, Input, Button, Field, FieldGrid, Micro } from '@/components/ui';
import { RepoPicker, type RepoPickerRepo } from '@/components/forge/RepoPicker';
import { createProjectAction, type NewProjectState } from './actions';

const DESIGN_STAGES = ['exploration', 'spec', 'plan'] as const;

function isContiguous(selected: string[]) {
  if (selected.length <= 1) return true;
  const indexes = selected.map((stage) => DESIGN_STAGES.indexOf(stage as never)).sort((a, b) => a - b);
  return indexes.every((value, index) => index === 0 || value === indexes[index - 1] + 1);
}

export function NewProjectForm({ repos }: { repos: RepoPickerRepo[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [visibility, setVisibility] = useState('public');
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState<NewProjectState, FormData>(createProjectAction, {});

  const nameError = state.error?.field === 'name' ? state.error.message : null;
  const repoError = state.error?.field === 'repoIds' ? state.error.message : null;
  const contiguous = useMemo(() => isContiguous(selectedStages), [selectedStages]);
  const entryStage = selectedStages[0] ?? 'exploration';
  const requiresExploration = entryStage === 'spec';
  const requiresSpec = entryStage === 'plan';

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      {selected.map((id) => <input key={id} type="hidden" name="repoIds" value={id} />)}
      {selectedStages.map((stage) => <input key={stage} type="hidden" name="selectedDesignStages" value={stage} />)}
      <input type="hidden" name="visibility" value={visibility} />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex flex-col gap-5">
          <FieldGrid cols={2}>
            <Field label="Name" error={nameError ?? undefined}>
              {(p) => <Input {...p} name="name" placeholder="e.g. Unified Task API" autoFocus />}
            </Field>
          </FieldGrid>

          <Field label="Visibility">
            {() => (
              <div className="flex gap-2">
                {(['public', 'private'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={v}
                    onClick={() => setVisibility(v)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm',
                      visibility === v ? 'border-accent bg-accent/10' : 'border-line',
                    )}
                  >
                    {v === 'public' ? <Globe className="size-4" /> : <Lock className="size-4" />}
                    {v}
                  </button>
                ))}
              </div>
            )}
          </Field>

          <Field label="Design run" hint="Leave empty for Full SDLC">
            {() => (
              <div className="grid gap-2">
                {DESIGN_STAGES.map((stage) => {
                  const checked = selectedStages.includes(stage);
                  return (
                    <label key={stage} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={stage === 'spec' ? 'Start at spec' : `Include ${stage}`}
                        checked={checked}
                        onChange={() => {
                          setSelectedStages((current) => {
                            const next = checked ? current.filter((value) => value !== stage) : [...current, stage];
                            return [...next].sort((a, b) => DESIGN_STAGES.indexOf(a as never) - DESIGN_STAGES.indexOf(b as never));
                          });
                        }}
                      />
                      <span>{stage}</span>
                    </label>
                  );
                })}
                {!contiguous ? <Micro role="alert" className="text-rose">Choose a contiguous design run.</Micro> : null}
              </div>
            )}
          </Field>

          {requiresExploration ? (
            <Field label="Exploration artifact">
              {(p) => <Input {...p} type="file" name="artifact" accept=".md,text/markdown,text/plain" />}
            </Field>
          ) : null}
          {requiresSpec ? (
            <Field label="Specification artifact">
              {(p) => <Input {...p} type="file" name="artifact" accept=".md,text/markdown,text/plain" />}
            </Field>
          ) : null}

          {state.error?.field === 'artifact' ? <Micro role="alert" className="text-rose">{state.error.message}</Micro> : null}
          <RepoPicker repos={repos} selected={selected} onChange={setSelected} />
          {repoError ? <Micro role="alert" className="text-rose">{repoError}</Micro> : null}
        </CardContent>

        <CardFooter className="mt-auto flex items-center justify-end">
          <Button type="submit" loading={pending} rightIcon={<ArrowRight />}>
            {pending ? 'Creating…' : 'Create project'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
