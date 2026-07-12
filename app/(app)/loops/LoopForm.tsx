'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, KeyRound } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Input, Field, Textarea, Label, Micro } from '@/components/ui';
import { showToast } from '@/components/ui/toast';
import { nextRuns } from '@/loops/cron';
import { formatDateTime } from '@/lib/format-date';
import type { LoopRow } from '@/db/schema/loop';

export interface RepoOption {
  id: string;
  name: string;
}

/** Small segmented control (radiogroup) — mirrors the Models tab toggles. */
export function Segmented({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-[var(--r-md)] border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-label={o.label}
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'focus-ring rounded-[calc(var(--r-md)-2px)] px-3 py-1 text-sm transition-colors',
            value === o.value ? 'bg-accent-tint font-medium text-accent-deep' : 'text-ink-soft hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type LoopMode = 'recurring' | 'manual' | 'event';

export function LoopForm({
  mode,
  loop,
  repoOptions,
  onDone,
}: {
  mode: 'add' | 'edit';
  loop?: LoopRow;
  repoOptions: RepoOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(loop?.name ?? '');
  const [goalMd, setGoalMd] = useState((loop?.config as { goalMd?: string } | null)?.goalMd ?? '');
  const [workerTier, setWorkerTier] = useState<'standard' | 'complex'>(loop?.workerTier ?? 'complex');
  const [loopMode, setLoopMode] = useState((loop?.mode as LoopMode | undefined) ?? 'recurring');
  const [cron, setCron] = useState(loop?.cron ?? '0 3 * * *');
  const [targetBranch, setTargetBranch] = useState(loop?.targetBranch ?? '');
  const [repoIds, setRepoIds] = useState<string[]>(loop?.repoIds ?? []);
  const [enabled, setEnabled] = useState(loop?.enabled ?? true);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const preview = nextRuns(cron, 3).map((d) => formatDateTime(d));
  const recurring = loopMode === 'recurring';
  const eventMode = loopMode === 'event';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name,
        kind: 'maintenance',
        config: { goalMd },
        workerTier,
        mode: loopMode,
        cron: recurring ? cron : null,
        targetBranch: targetBranch.trim() || null,
        repoIds,
        enabled: recurring ? enabled : true,
      };
      const res = loop
        ? await fetch(`/api/loops/${loop.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/loops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => null)) as { message?: string; eventToken?: string } | null;
      if (!res.ok) {
        setError(body?.message ?? 'Could not save the loop.');
        return;
      }
      const revealed = body?.eventToken ?? null;
      setRevealedToken(revealed);
      router.refresh();
      if (!revealed) onDone();
    } finally {
      setBusy(false);
    }
  }

  async function onRotateToken() {
    if (!loop) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/loops/${loop.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rotateEventToken: true }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; eventToken?: string } | null;
      if (!res.ok) {
        setError(body?.message ?? 'Could not rotate the token.');
        return;
      }
      setRevealedToken(body?.eventToken ?? null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!loop) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/loops/${loop.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
      onDone();
      router.refresh();
    } catch {
      showToast({ type: 'error', message: 'Couldn’t delete the loop — try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label={mode === 'add' ? 'New loop' : 'Edit loop'} onSubmit={onSubmit} className="flex flex-col gap-4 bg-surface-2/50 p-4">
      <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Codebase hygiene" autoFocus />}</Field>

      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1.5">
          <Label as="span">Worker tier</Label>
          <Segmented label="Worker tier" value={workerTier} onChange={(v) => setWorkerTier(v as 'standard' | 'complex')} options={[{ value: 'standard', label: 'standard' }, { value: 'complex', label: 'complex' }]} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label as="span">Mode</Label>
          <Segmented label="Mode" value={loopMode} onChange={(v) => setLoopMode(v as LoopMode)} options={[{ value: 'recurring', label: 'Recurring' }, { value: 'manual', label: 'Manual' }, { value: 'event', label: 'Event' }]} />
        </div>
        {recurring ? (
          <div className="flex flex-col gap-1.5">
            <Label as="span">Status</Label>
            <Segmented label="Status" value={enabled ? 'enabled' : 'paused'} onChange={(v) => setEnabled(v === 'enabled')} options={[{ value: 'enabled', label: 'Enabled' }, { value: 'paused', label: 'Paused' }]} />
          </div>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <Label as="span">Repositories</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {repoOptions.map((r) => (
            <label key={r.id} className="flex items-center gap-1.5 text-sm text-ink">
              <input type="checkbox" className="accent-accent" checked={repoIds.includes(r.id)} onChange={(e) => setRepoIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))} />
              {r.name}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Goal">{(p) => <Textarea {...p} value={goalMd} onChange={(e) => setGoalMd(e.target.value)} className="min-h-20" placeholder={eventMode ? 'What should each incoming event make this loop do?' : 'What should this loop keep true?'} />}</Field>

      {recurring ? (
        <Field label="Schedule (cron)" hint={preview.length ? `Next (SGT): ${preview.join(' · ')}` : 'Enter a valid cron expression'}>
          {(p) => <Input {...p} value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" />}
        </Field>
      ) : eventMode ? (
        <Micro className="block text-ink-soft">Event mode runs only when an external caller presents the loop token plus an idempotency key.</Micro>
      ) : (
        <Micro className="block text-ink-soft">Manual mode runs only when you click Run now, and never on a schedule.</Micro>
      )}

      <Field label="Target branch (optional)" hint="Branch to fork from and open the PR into. Blank = the branch the repo is currently on.">
        {(p) => <Input {...p} value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} placeholder="current branch" className="font-mono" />}
      </Field>

      {eventMode && loop ? (
        <div className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
          <Micro className="flex-1 text-ink-soft">Rotate the event token to invalidate the previous machine credential immediately.</Micro>
          <Button type="button" variant="secondary" leftIcon={<KeyRound />} onClick={onRotateToken} disabled={busy}>Rotate token</Button>
        </div>
      ) : null}

      {revealedToken ? (
        <div className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
          <Micro className="flex-1 text-sage">Event token (shown once — copy it now): <span className="font-mono">{revealedToken}</span></Micro>
          <Button type="button" variant="secondary" onClick={onDone}>Done</Button>
        </div>
      ) : null}
      {error ? <Micro role="alert" className="block text-rose">{error}</Micro> : null}

      <div className="flex items-center justify-between gap-2">
        <div>
          {mode === 'edit' ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <Micro className="text-rose">Delete permanently?</Micro>
                <Button type="button" variant="ghost" onClick={onDelete} loading={busy} className="text-rose hover:text-rose">Confirm delete</Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</Button>
              </div>
            ) : (
              <Button type="button" variant="ghost" leftIcon={<Trash2 />} onClick={() => setConfirmDelete(true)} disabled={busy} className="text-rose hover:text-rose">Delete</Button>
            )
          ) : null}
        </div>
        <div className="flex items-center gap-2.5">
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" loading={busy}>{loop ? 'Save loop' : 'Create loop'}</Button>
        </div>
      </div>
    </form>
  );
}
