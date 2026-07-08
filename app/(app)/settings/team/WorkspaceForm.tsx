'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Title, Text, Field, Input, Button } from '@/components/ui';

/**
 * Team settings → workspace path (FR-8/FR-9). Sets `team.workspace_root_path`
 * via PUT /api/team/workspace; the server validates the path is a direct sibling
 * child of the operator base and returns a 400 with the reason on rejection.
 */
export function WorkspaceForm({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
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
      setSaved(true);
      router.refresh();
    } catch {
      setError('Network error — please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Title>Workspace path</Title>
        <Text>The local filesystem root for this team&apos;s repos and journal. Must sit directly under the operator workspace base.</Text>
        <Field label="Workspace root path">
          {(p) => (
            <Input
              {...p}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
            />
          )}
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-rose">
            {error}
          </p>
        ) : null}
        {saved ? <p className="text-sm text-sage">Saved.</p> : null}
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={busy || !value.trim() || value === current}>
            {busy ? 'Saving…' : 'Save path'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
