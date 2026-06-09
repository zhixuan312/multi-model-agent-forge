'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

const DEFAULT_MMA_BASE_URL = 'http://127.0.0.1:7337';

export interface ConnectionsData {
  mmaBaseUrl: string | null;
  mmaTokenSet: boolean;
  gitTokenSet: boolean;
  openaiTranscriptionKeySet: boolean;
}

const label = 'mb-1.5 block text-[11.5px] font-semibold text-ink-soft';
const input =
  'w-full rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

function SetIndicator({ set, testid }: { set: boolean; testid: string }) {
  return set ? (
    <span data-testid={testid} className="text-xs font-medium text-sage">
      • set
    </span>
  ) : (
    <span data-testid={testid} className="text-xs font-medium text-ink-faint">
      — not set
    </span>
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
    <div className="mt-4 flex flex-col gap-4">
      {/* MMA */}
      <form
        aria-label="MMA connection"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { mmaBaseUrl };
          if (mmaToken !== '') body.mmaToken = mmaToken;
          void save('mma', body);
        }}
        className="rounded-[var(--r-lg)] border border-line bg-surface p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-ink">MMA</div>
          <SetIndicator set={initial.mmaTokenSet} testid="mma-token-indicator" />
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="mma-base-url" className={label}>
              Base URL
            </label>
            <input
              id="mma-base-url"
              value={mmaBaseUrl}
              onChange={(e) => setMmaBaseUrl(e.target.value)}
              className={cn(input, 'font-mono')}
            />
          </div>
          <div>
            <label htmlFor="mma-token" className={label}>
              Bearer token{' '}
              <span className="font-normal text-ink-faint">
                · {initial.mmaTokenSet ? 'set — blank keeps it' : 'authorizes every rod call'}
              </span>
            </label>
            <input
              id="mma-token"
              type="password"
              value={mmaToken}
              onChange={(e) => setMmaToken(e.target.value)}
              placeholder={initial.mmaTokenSet ? '•••••••• (unchanged)' : ''}
              className={cn(input, 'font-mono')}
            />
          </div>
        </div>
        <div className="mt-3.5 flex items-center justify-end gap-2.5">
          {saved === 'mma' ? <span className="text-sm text-ink-soft">Saved.</span> : null}
          <button
            type="submit"
            disabled={busy === 'mma'}
            className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy === 'mma' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {/* Git */}
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
        className="rounded-[var(--r-lg)] border border-line bg-surface p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-ink">Git</div>
          <SetIndicator set={initial.gitTokenSet} testid="git-token-indicator" />
        </div>
        <div>
          <label htmlFor="git-token" className={label}>
            Service token{' '}
            <span className="font-normal text-ink-faint">
              · {initial.gitTokenSet ? 'set — blank keeps it' : 'clones & pulls every team repo'}
            </span>
          </label>
          <input
            id="git-token"
            type="password"
            value={gitToken}
            onChange={(e) => setGitToken(e.target.value)}
            placeholder={initial.gitTokenSet ? '•••••••• (unchanged)' : ''}
            className={cn(input, 'font-mono')}
          />
        </div>
        <div className="mt-3 rounded-[var(--r)] border border-accent-tint bg-accent-tint/40 p-3 text-xs leading-relaxed text-ink-soft">
          <strong>High-value secret</strong> — it can clone &amp; pull every team repo. Stored
          encrypted; never exposed to the browser or to MMA task content.
        </div>
        <div className="mt-3.5 flex items-center justify-end gap-2.5">
          {saved === 'git' ? <span className="text-sm text-ink-soft">Saved.</span> : null}
          <button
            type="submit"
            disabled={busy === 'git'}
            className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy === 'git' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {/* OpenAI transcription */}
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
        className="rounded-[var(--r-lg)] border border-line bg-surface p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-ink">OpenAI transcription</div>
          <SetIndicator set={initial.openaiTranscriptionKeySet} testid="openai-key-indicator" />
        </div>
        <div>
          <label htmlFor="openai-key" className={label}>
            API key{' '}
            <span className="font-normal text-ink-faint">· voice → text (optional)</span>
          </label>
          <input
            id="openai-key"
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder={initial.openaiTranscriptionKeySet ? '•••••••• (unchanged)' : ''}
            className={cn(input, 'font-mono')}
          />
        </div>
        <div className="mt-3.5 flex items-center justify-end gap-2.5">
          {saved === 'openai' ? <span className="text-sm text-ink-soft">Saved.</span> : null}
          <button
            type="submit"
            disabled={busy === 'openai'}
            className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy === 'openai' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {error ? (
        <p id={errId} role="alert" className="text-sm text-rose">
          {error}
        </p>
      ) : null}
    </div>
  );
}
