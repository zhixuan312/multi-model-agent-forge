'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Field, FieldGrid, Input, Button, Badge, Banner, Micro } from '@/components/ui';

const DEFAULT_MMA_BASE_URL = 'http://127.0.0.1:7337';

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
 * Connections form (Spec 2 §Connections / connections.html): MMA (base URL +
 * bearer) and Git (service token), plus the OpenAI transcription key. Each token
 * input is write-only — blank leaves the stored secret untouched. Sections save
 * independently via PUT /api/connections.
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
    <div className="flex flex-col gap-4">
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
          <CardHeader>
            <CardTitle>MMA</CardTitle>
            <SetIndicator set={initial.mmaTokenSet} testid="mma-token-indicator" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-5">
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
            <div className="flex items-center justify-end gap-2.5">
              {saved === 'mma' ? <Micro>Saved.</Micro> : null}
              <Button type="submit" loading={busy === 'mma'}>
                {busy === 'mma' ? 'Saving…' : 'Save'}
              </Button>
            </div>
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
          <CardHeader>
            <CardTitle>Git</CardTitle>
            <SetIndicator set={initial.gitTokenSet} testid="git-token-indicator" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-5">
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
            <Banner
              variant="warning"
              title="High-value secret"
              description="It can clone & pull every team repo. Stored encrypted; never exposed to the browser or to MMA task content."
            />
            <div className="flex items-center justify-end gap-2.5">
              {saved === 'git' ? <Micro>Saved.</Micro> : null}
              <Button type="submit" loading={busy === 'git'}>
                {busy === 'git' ? 'Saving…' : 'Save'}
              </Button>
            </div>
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
          <CardHeader>
            <CardTitle>OpenAI transcription</CardTitle>
            <SetIndicator set={initial.openaiTranscriptionKeySet} testid="openai-key-indicator" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-5">
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
            <div className="flex items-center justify-end gap-2.5">
              {saved === 'openai' ? <Micro>Saved.</Micro> : null}
              <Button type="submit" loading={busy === 'openai'}>
                {busy === 'openai' ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      {error ? (
        <Micro id={errId} role="alert" className="block text-rose">
          {error}
        </Micro>
      ) : null}
    </div>
  );
}
