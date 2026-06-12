'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Field, FieldGrid, Input, Button, Badge, Heading, Micro } from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';

const DEFAULT_MMA_BASE_URL = 'http://127.0.0.1:7337';

const CONNECTIONS_NOTE = `**Secrets & what they do**

- **MMA** — the endpoint Forge calls every rod through
- **Git** — clones & pulls every team repo (a high-value secret)
- **OpenAI** — optional voice → text

Every token is stored encrypted and shown only as set / not set — never sent to the browser or to MMA task content.`;

export interface ConnectionsData {
  mmaBaseUrl: string | null;
  mmaTokenSet: boolean;
  gitTokenSet: boolean;
  openaiTranscriptionKeySet: boolean;
}

function SetIndicator({ set, testid }: { set: boolean; testid: string }) {
  return set ? (
    <Badge data-testid={testid} variant="sage" dot size="sm">
      set
    </Badge>
  ) : (
    <Badge data-testid={testid} size="sm">
      not set
    </Badge>
  );
}

/**
 * GroupHeader — a connection card's title row: the serif heading + the set/not-set
 * indicator.
 */
function GroupHeader({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Heading className="!text-base">{title}</Heading>
      {children}
    </div>
  );
}

function SaveRow({ saved, busy, label }: { saved: boolean; busy: boolean; label: string }) {
  return (
    <div className="flex items-center justify-end gap-2.5">
      {saved ? <Micro>Saved.</Micro> : null}
      <Button type="submit" loading={busy}>
        {busy ? 'Saving…' : label}
      </Button>
    </div>
  );
}

/**
 * Connections form (Spec 2 §Connections / connections.html): MMA (base URL +
 * bearer) and Git (service token), plus the OpenAI transcription key — each its
 * OWN card. Token inputs are write-only: blank leaves the stored secret intact.
 * Sections save independently via PUT /api/connections.
 */
export function ConnectionsForm({ initial }: { initial: ConnectionsData }) {
  const router = useRouter();
  const [mmaBaseUrl, setMmaBaseUrl] = useState(initial.mmaBaseUrl ?? DEFAULT_MMA_BASE_URL);
  const [mmaToken, setMmaToken] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'mma' | 'git' | 'openai'>(null);
  const [saved, setSaved] = useState<null | 'mma' | 'git' | 'openai'>(null);

  async function save(which: 'mma' | 'git' | 'openai', body: Record<string, unknown>) {
    setError(null);
    setBusy(which);
    setSaved(null);
    try {
      const res = await fetch('/api/connections', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not save.');
        return;
      }
      setSaved(which);
      if (which === 'mma') setMmaToken('');
      if (which === 'git') setGitToken('');
      if (which === 'openai') setOpenaiKey('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const errId = 'connections-error';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      {/* PRIMARY — one isolated card per connection (heterogeneous settings) */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        {/* MMA */}
        <Card>
          <form
            aria-label="MMA connection"
            onSubmit={(e) => {
              e.preventDefault();
              const body: Record<string, unknown> = { mmaBaseUrl };
              if (mmaToken !== '') body.mmaToken = mmaToken;
              void save('mma', body);
            }}
          >
            <CardContent className="flex flex-col gap-4 py-5">
              <GroupHeader title="MMA">
                <SetIndicator set={initial.mmaTokenSet} testid="mma-token-indicator" />
              </GroupHeader>
              <FieldGrid cols={2}>
                <Field label="Base URL">
                  {(p) => (
                    <Input {...p} value={mmaBaseUrl} onChange={(e) => setMmaBaseUrl(e.target.value)} className="font-mono" />
                  )}
                </Field>
                <Field
                  label="Bearer token"
                  hint={initial.mmaTokenSet ? 'set — blank keeps it' : 'authorizes every rod call'}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="password"
                      value={mmaToken}
                      onChange={(e) => setMmaToken(e.target.value)}
                      placeholder={initial.mmaTokenSet ? '•••••••• (unchanged)' : ''}
                      className="font-mono"
                    />
                  )}
                </Field>
              </FieldGrid>
              <SaveRow saved={saved === 'mma'} busy={busy === 'mma'} label="Save" />
            </CardContent>
          </form>
        </Card>

        {/* Git */}
        <Card>
          <form
            aria-label="Git connection"
            onSubmit={(e) => {
              e.preventDefault();
              if (gitToken === '') {
                setError('Enter a git service token to save.');
                return;
              }
              void save('git', { gitToken });
            }}
          >
            <CardContent className="flex flex-col gap-4 py-5">
              <GroupHeader title="Git">
                <SetIndicator set={initial.gitTokenSet} testid="git-token-indicator" />
              </GroupHeader>
              <Field
                label="Service token"
                hint={initial.gitTokenSet ? 'set — blank keeps it' : 'clones & pulls every team repo'}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    value={gitToken}
                    onChange={(e) => setGitToken(e.target.value)}
                    placeholder={initial.gitTokenSet ? '•••••••• (unchanged)' : ''}
                    className="font-mono"
                  />
                )}
              </Field>
              <SaveRow saved={saved === 'git'} busy={busy === 'git'} label="Save" />
            </CardContent>
          </form>
        </Card>

        {/* OpenAI transcription */}
        <Card>
          <form
            aria-label="OpenAI transcription"
            onSubmit={(e) => {
              e.preventDefault();
              if (openaiKey === '') {
                setError('Enter an OpenAI key to save.');
                return;
              }
              void save('openai', { openaiTranscriptionKey: openaiKey });
            }}
          >
            <CardContent className="flex flex-col gap-4 py-5">
              <GroupHeader title="OpenAI transcription">
                <SetIndicator set={initial.openaiTranscriptionKeySet} testid="openai-key-indicator" />
              </GroupHeader>
              <Field label="API key" hint="voice → text (optional)">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder={initial.openaiTranscriptionKeySet ? '•••••••• (unchanged)' : ''}
                    className="font-mono"
                  />
                )}
              </Field>
              <SaveRow saved={saved === 'openai'} busy={busy === 'openai'} label="Save" />
            </CardContent>
          </form>
        </Card>

        {error ? (
          <Micro id={errId} role="alert" className="block text-rose">
            {error}
          </Micro>
        ) : null}
      </div>

      {/* RAIL — one combined note */}
      <div className="flex flex-col gap-4">
        <SettingsAccessNote body={CONNECTIONS_NOTE} />
      </div>
    </div>
  );
}
