'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, Input, Badge, Micro } from '@/components/ui';
import { SettingCard } from '@/components/forge/SettingCard';

/**
 * Team settings → git token (FR-6/FR-9). Sets/rotates the team's git credential
 * via PUT /api/connections (updateConnections writes `team.git_token_ref`). The
 * value is write-only — the server stores it encrypted and only ever reports
 * set / not set. Read-on-load credential card → Edit → Save, matching the org
 * connection cards.
 */
export function GitTokenForm({ tokenSet }: { tokenSet: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setOpen(false);
    setToken('');
    setError(null);
  };

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
      title="Git token"
      ariaLabel="Git token"
      indicator={
        tokenSet ? (
          <Badge variant="sage" dot size="sm">
            set
          </Badge>
        ) : (
          <Badge size="sm">not set</Badge>
        )
      }
      summary={<Micro className="!text-ink-soft">Clones and pulls every repository for this team</Micro>}
      open={open}
      busy={busy}
      saveLabel="Save token"
      canSave={token.trim() !== ''}
      error={error}
      onEdit={() => {
        setError(null);
        setOpen(true);
      }}
      onCancel={cancel}
      onSubmit={submit}
    >
      <Field
        label="Service token"
        hint={tokenSet ? 'Saving replaces the current token.' : 'A personal access token with repo read access.'}
      >
        {(p) => <Input {...p} type="password" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />}
      </Field>
    </SettingCard>
  );
}
