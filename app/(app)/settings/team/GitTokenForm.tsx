'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Title, Text, Field, Input, Button, Badge } from '@/components/ui';

/**
 * Team settings → git token (FR-6/FR-9). Sets/rotates the team's git credential
 * via PUT /api/connections (updateConnections writes `team.git_token_ref`). The
 * value is write-only — the server stores it encrypted and only ever reports
 * set / not set.
 */
export function GitTokenForm({ tokenSet }: { tokenSet: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connections', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gitToken: token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not save the git token.');
        return;
      }
      setToken('');
      setEditing(false);
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
        <div className="flex items-center justify-between gap-3">
          <Title>Git token</Title>
          {tokenSet ? (
            <Badge variant="sage" dot size="sm">
              set
            </Badge>
          ) : (
            <Badge size="sm">not set</Badge>
          )}
        </div>
        <Text>Clones and pulls every repository for this team. Stored encrypted — shown only as set / not set.</Text>
        {editing ? (
          <>
            <Field
              label="Service token"
              hint={tokenSet ? 'Saving replaces the current token.' : 'A personal access token with repo read access.'}
            >
              {(p) => <Input {...p} type="password" value={token} onChange={(e) => setToken(e.target.value)} />}
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-rose">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setToken('');
                  setError(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={busy || !token.trim()}>
                {busy ? 'Saving…' : 'Save token'}
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {tokenSet ? 'Rotate token' : 'Set token'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
