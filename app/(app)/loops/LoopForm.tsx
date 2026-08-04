'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, KeyRound } from 'lucide-react';
import { Button, Checkbox, Input, Field, Textarea, Label, Micro, Segmented } from '@/components/ui';
import { showToast } from '@/components/ui/toast';
import { nextRuns } from '@/loops/cron';
import { formatDateTime } from '@/lib/format-date';
import { LOOP_MODE, LOOP_WORKER_TIER, type LoopMode, type LoopWorkerTier } from '@/db/enums';
import type { LoopRow } from '@/db/schema/loop';
import { responseError } from '@/lib/err';

export interface RepoOption {
  id: string;
  name: string;
}

/**
 * The two enum-backed choosers, derived from the enums rather than hand-listed.
 *
 * The TYPE already came from the enum — a comment here recorded that a local union had been
 * removed "so a new mode would have compiled here while the form silently offered three".
 * The OPTIONS were still written out, which is the half that produces that exact outcome: a
 * value added to `LOOP_MODE` type-checks everywhere and simply never appears in the form.
 *
 * The label maps are total, so a new value fails the build here — where someone has to
 * decide what to call it — instead of going missing from the UI.
 *
 * (The Status control below is genuinely a boolean — `enabled` — not an enum, so it stays
 * a literal pair.)
 */
const MODE_LABEL = {
  recurring: 'Recurring',
  manual: 'Manual',
  event: 'Event',
} as const satisfies Record<LoopMode, string>;

const TIER_LABEL = {
  standard: 'standard',
  complex: 'complex',
} as const satisfies Record<LoopWorkerTier, string>;

const MODE_OPTIONS = LOOP_MODE.map((m) => ({ value: m, label: MODE_LABEL[m] }));
const TIER_OPTIONS = LOOP_WORKER_TIER.map((t) => ({ value: t, label: TIER_LABEL[t] }));

/** The inline notice strip this form uses for the token affordances — written out twice,
 *  once for the rotate prompt and once for the revealed token. */
function NoticeBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
      {children}
    </div>
  );
}

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
  const [workerTier, setWorkerTier] = useState<LoopWorkerTier>(loop?.workerTier ?? 'complex');
  const [loopMode, setLoopMode] = useState((loop?.mode as LoopMode | undefined) ?? 'recurring');
  const [cron, setCron] = useState(loop?.cron ?? '0 3 * * *');
  const [targetBranch, setTargetBranch] = useState(loop?.targetBranch ?? '');
  const [repoIds, setRepoIds] = useState<string[]>(loop?.repoIds ?? []);
  const [enabled, setEnabled] = useState(loop?.enabled ?? true);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

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
        // Manual loops only fire when an admin clicks Run now, so there is nothing to
        // pause. Recurring AND event loops both fire on their own and must be pausable —
        // this used to force `true` for every non-recurring mode, so an event loop could
        // not be stopped at all.
        enabled: loopMode === 'manual' ? true : enabled,
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
    } catch {
      // A THROWN fetch (offline, DNS, aborted) never reaches the !res.ok branch, so
      // without this the handler fell straight through `finally` and surfaced nothing.
      setError('Network error — please retry.');
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
    } catch {
      // A THROWN fetch (offline, DNS, aborted) never reaches the !res.ok branch, so
      // without this the handler fell straight through `finally` and surfaced nothing.
      setError('Network error — please retry.');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!loop) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/loops/${loop.id}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast({ type: 'error', message: await responseError(res, 'Couldn’t delete the loop — try again.') });
        return;
      }
      onDone();
      router.refresh();
    } catch {
      showToast({ type: 'error', message: 'Network error — couldn’t delete the loop.' });
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
          <Segmented label="Worker tier" value={workerTier} onChange={(v) => setWorkerTier(v as LoopWorkerTier)} options={TIER_OPTIONS} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label as="span">Mode</Label>
          <Segmented label="Mode" value={loopMode} onChange={(v) => setLoopMode(v as LoopMode)} options={MODE_OPTIONS} />
        </div>
        {loopMode !== 'manual' ? (
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
              <Checkbox
                checked={repoIds.includes(r.id)}
                onCheckedChange={(v) => setRepoIds((ids) => (v === true ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
              />
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
        <NoticeBar>
          <Micro className="flex-1 text-ink-soft">Rotate the event token to invalidate the previous machine credential immediately.</Micro>
          {confirmRotate ? (
            <div className="flex items-center gap-2">
              <Micro className="text-rose">Invalidate the old token?</Micro>
              <Button type="button" variant="secondary" leftIcon={<KeyRound />} loading={busy} onClick={() => { setConfirmRotate(false); onRotateToken(); }}>Confirm rotate</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmRotate(false)}>Keep</Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" leftIcon={<KeyRound />} onClick={() => setConfirmRotate(true)} disabled={busy}>Rotate token</Button>
          )}
        </NoticeBar>
      ) : null}

      {revealedToken ? (
        <NoticeBar>
          <Micro className="flex-1 text-sage">Event token (shown once — copy it now): <span className="font-mono">{revealedToken}</span></Micro>
          <Button type="button" variant="secondary" onClick={onDone}>Done</Button>
        </NoticeBar>
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
