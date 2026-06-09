'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { cn } from '@/lib/cn';
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

  const inputCls =
    'rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <form action={formAction} className="max-w-2xl">
      {/* selected repo ids ride along as hidden fields */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="repoIds" value={id} />
      ))}

      <div className="mb-5">
        <label htmlFor="project-name" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          Name
        </label>
        <input
          id="project-name"
          name="name"
          className={cn(inputCls, 'w-full')}
          aria-describedby={nameError ? 'name-error' : undefined}
          aria-invalid={nameError ? true : undefined}
        />
      </div>

      <fieldset className="mb-5">
        <legend className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          Visibility
        </legend>
        <div role="radiogroup" aria-label="Visibility" className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="visibility" value="public" defaultChecked className="accent-[var(--accent)]" />
            <span>⊕ Public</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="visibility" value="private" className="accent-[var(--accent)]" />
            <span>🔒 Private</span>
          </label>
        </div>
        <p className="mt-1 text-xs text-ink-faint">Private hides this project&apos;s work artifacts, not code.</p>
      </fieldset>

      <div className="mb-5">
        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          Repositories
        </span>
        <RepoPicker repos={repos} selected={selected} onChange={setSelected} />
      </div>

      {/* a11y: validation errors are announced politely */}
      <div aria-live="polite">
        {nameError ? (
          <p id="name-error" role="alert" className="mb-2 text-sm text-rose">{nameError}</p>
        ) : null}
        {repoError ? (
          <p id="repos-error" role="alert" className="mb-2 text-sm text-rose">{repoError}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create & start exploration →'}
        </button>
      </div>
    </form>
  );
}
