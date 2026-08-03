'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, Input } from '@/components/ui';
import { FormPanel, SetIndicator } from '@/components/patterns/form-panel';
import { responseError } from '@/lib/err';

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
        setError(await responseError(res, 'Could not save the workspace path.'));
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
    <FormPanel
      heading="Workspace path"
      ariaLabel="Workspace path"
      indicator={<SetIndicator set={current.trim() !== ''} />}
      disclosure={{
        open,
        summary: current,
        onEdit: () => {
          setError(null);
          setValue(current);
          setOpen(true);
        },
      }}
      busy={busy}
      saveLabel="Save path"
      canSave={value.trim() !== '' && value !== current}
      error={error}
      onCancel={cancel}
      onSubmit={submit}
    >
      <Field
        label="Workspace root path"
        hint="A directory name directly under the operator workspace base. Stored relative to that base, so the value stays valid if the server moves."
      >
        {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" />}
      </Field>
    </FormPanel>
  );
}
