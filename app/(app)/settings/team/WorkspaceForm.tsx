'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, Input, Mono } from '@/components/ui';
import { SettingCard } from '@/components/forge/SettingCard';

/**
 * Team settings → workspace path (FR-8/FR-9). Sets `team.workspace_root_path`
 * via PUT /api/team/workspace; the server validates the path is a direct sibling
 * child of the operator base and returns a 400 with the reason on rejection.
 * Read-on-load credential card → Edit → Save, matching the org connection cards.
 */
export function WorkspaceForm({ current }: { current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setOpen(false);
    setValue(current);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/team/workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceRootPath: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not save the workspace path.');
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Network error — please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingCard
      title="Workspace path"
      ariaLabel="Workspace path"
      summary={<Mono className="!text-xs text-ink-soft">{current}</Mono>}
      open={open}
      busy={busy}
      saveLabel="Save path"
      canSave={value.trim() !== '' && value !== current}
      error={error}
      onEdit={() => {
        setError(null);
        setValue(current);
        setOpen(true);
      }}
      onCancel={cancel}
      onSubmit={submit}
    >
      <Field label="Workspace root path" hint="Must sit directly under the operator workspace base.">
        {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" />}
      </Field>
    </SettingCard>
  );
}
