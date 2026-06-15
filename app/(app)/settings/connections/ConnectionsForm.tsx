'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Field, FieldGrid, Input, Button, Badge, TextStrong, Micro, Mono } from '@/components/ui';
import { KeyRound, Pencil } from 'lucide-react';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';
import { VerifyResultBox } from '@/components/forge/VerifyResultBox';

const DEFAULT_MMA_BASE_URL = 'http://127.0.0.1:7337';

const CONNECTIONS_NOTE = `### Secrets

- **MMA** — the local engine Forge runs everything through
- **Git** — clones & pulls every team repo
- **Speech-to-text** — optional voice transcription

### Storage

- **Encrypted** — shown only as set / not set, never sent to the browser`;

export interface ConnectionsData {
  mmaBaseUrl: string | null;
  mmaTokenSet: boolean;
  gitTokenSet: boolean;
  openaiTranscriptionKeySet: boolean;
}

type Conn = 'mma' | 'git' | 'openai';
type ValidateResult = { ok: boolean; detail: string };

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
 * One connection in its own card — read view on load (title + indicator/summary +
 * Edit), opening to a form (fields + Cancel · Validate · Save). Validate probes
 * the live connection so you know it works before (or without) saving.
 */
function ConnectionCard({
  title,
  indicator,
  summary,
  ariaLabel,
  open,
  busy,
  validating,
  validateResult,
  onEdit,
  onCancel,
  onValidate,
  onSubmit,
  children,
}: {
  title: string;
  indicator?: React.ReactNode;
  summary?: React.ReactNode;
  ariaLabel: string;
  open: boolean;
  busy: boolean;
  validating: boolean;
  validateResult: ValidateResult | null;
  onEdit: () => void;
  onCancel: () => void;
  onValidate: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <TextStrong className="!text-sm !text-ink">{title}</TextStrong>
              {indicator}
            </div>
            {!open && summary ? <div className="mt-1.5">{summary}</div> : null}
          </div>
          {!open ? (
            <Button size="sm" variant="ghost" leftIcon={<Pencil />} aria-label={`Edit ${title}`} onClick={onEdit}>
              Edit
            </Button>
          ) : null}
        </div>
        {open ? (
          <form
            aria-label={ariaLabel}
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            className="flex flex-col gap-4 border-t border-line pt-4"
          >
            {children}
            {validateResult ? (
              <VerifyResultBox ok={validateResult.ok}>
                <Micro className="block !text-ink-soft">{validateResult.detail}</Micro>
              </VerifyResultBox>
            ) : null}
            <div className="flex items-center justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={onValidate} loading={validating}>
                {validating ? 'Validating…' : 'Validate'}
              </Button>
              <Button type="submit" loading={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Connections form: MMA (the local engine — base URL + an optional advanced
 * bearer for a remote MMA), Git (service token), and Speech-to-text (OpenAI
 * key) — each its own card with read-on-load → Edit → Validate · Save. Token
 * inputs are write-only; sections save independently via PUT /api/connections.
 */
export function ConnectionsForm({
  initial,
  mmaBearer,
}: {
  initial: ConnectionsData;
  /** The auto-resolved local mmagent token (read-only display); null if none. */
  mmaBearer: string | null;
}) {
  const router = useRouter();
  const [mmaBaseUrl, setMmaBaseUrl] = useState(initial.mmaBaseUrl ?? DEFAULT_MMA_BASE_URL);
  const [gitToken, setGitToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | Conn>(null);
  const [open, setOpen] = useState<null | Conn>(null);
  const [validating, setValidating] = useState<null | Conn>(null);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);

  function edit(which: Conn) {
    setError(null);
    setValidateResult(null);
    setOpen(which);
  }

  function cancel() {
    setError(null);
    setValidateResult(null);
    setOpen(null);
    setGitToken('');
    setOpenaiKey('');
    setMmaBaseUrl(initial.mmaBaseUrl ?? DEFAULT_MMA_BASE_URL);
  }

  async function validate(which: Conn, token?: string) {
    setError(null);
    setValidateResult(null);
    setValidating(which);
    try {
      const res = await fetch('/api/connections/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: which, ...(token ? { token } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as (ValidateResult & { message?: string }) | null;
      if (!res.ok || !body) {
        setValidateResult({ ok: false, detail: body?.message ?? 'Could not run the check.' });
        return;
      }
      setValidateResult({ ok: !!body.ok, detail: body.detail });
    } catch {
      setValidateResult({ ok: false, detail: 'Could not reach the server.' });
    } finally {
      setValidating(null);
    }
  }

  async function save(which: Conn, body: Record<string, unknown>) {
    setError(null);
    setBusy(which);
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
      setGitToken('');
      setOpenaiKey('');
      setOpen(null);
      setValidateResult(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const errId = 'connections-error';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      {/* PRIMARY — one isolated card per connection */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        {/* MMA — the local engine; bearer auto-resolved, advanced only for remote */}
        <ConnectionCard
          title="MMA"
          ariaLabel="MMA connection"
          indicator={<SetIndicator set={mmaBearer !== null} testid="mma-token-indicator" />}
          summary={<Mono className="!text-xs text-ink-soft">{mmaBaseUrl}</Mono>}
          open={open === 'mma'}
          busy={busy === 'mma'}
          validating={validating === 'mma'}
          validateResult={open === 'mma' ? validateResult : null}
          onEdit={() => edit('mma')}
          onCancel={cancel}
          onValidate={() => validate('mma')}
          onSubmit={() => {
            void save('mma', { mmaBaseUrl });
          }}
        >
          <Field label="Base URL">
            {(p) => (
              <Input
                {...p}
                value={mmaBaseUrl}
                onChange={(e) => {
                  setMmaBaseUrl(e.target.value);
                  setValidateResult(null);
                }}
                className="font-mono"
              />
            )}
          </Field>
          <Field label="Bearer token" hint="auto — managed by your local mmagent; read-only here">
            {(p) => (
              <Input
                {...p}
                value={mmaBearer ?? ''}
                readOnly
                aria-readonly="true"
                placeholder="no local token found"
                className="cursor-not-allowed bg-surface-2 font-mono text-ink-soft"
              />
            )}
          </Field>
        </ConnectionCard>

        {/* Git */}
        <ConnectionCard
          title="Git"
          ariaLabel="Git connection"
          indicator={<SetIndicator set={initial.gitTokenSet} testid="git-token-indicator" />}
          open={open === 'git'}
          busy={busy === 'git'}
          validating={validating === 'git'}
          validateResult={open === 'git' ? validateResult : null}
          onEdit={() => edit('git')}
          onCancel={cancel}
          onValidate={() => validate('git', gitToken)}
          onSubmit={() => {
            if (gitToken === '') {
              setError('Enter a git service token to save.');
              return;
            }
            void save('git', { gitToken });
          }}
        >
          <Field label="Service token" hint={initial.gitTokenSet ? 'set — blank keeps it' : 'clones & pulls every team repo'}>
            {(p) => (
              <Input
                {...p}
                type="password"
                value={gitToken}
                onChange={(e) => {
                  setGitToken(e.target.value);
                  setValidateResult(null);
                }}
                placeholder={initial.gitTokenSet ? '•••••••• (unchanged)' : ''}
                className="font-mono"
              />
            )}
          </Field>
        </ConnectionCard>

        {/* Speech-to-text (OpenAI key) */}
        <ConnectionCard
          title="Speech to text"
          ariaLabel="Speech to text"
          indicator={<SetIndicator set={initial.openaiTranscriptionKeySet} testid="openai-key-indicator" />}
          open={open === 'openai'}
          busy={busy === 'openai'}
          validating={validating === 'openai'}
          validateResult={open === 'openai' ? validateResult : null}
          onEdit={() => edit('openai')}
          onCancel={cancel}
          onValidate={() => validate('openai', openaiKey)}
          onSubmit={() => {
            if (openaiKey === '') {
              setError('Enter an OpenAI key to save.');
              return;
            }
            void save('openai', { openaiTranscriptionKey: openaiKey });
          }}
        >
          <Field label="OpenAI API key" hint="voice → text (optional)">
            {(p) => (
              <Input
                {...p}
                type="password"
                value={openaiKey}
                onChange={(e) => {
                  setOpenaiKey(e.target.value);
                  setValidateResult(null);
                }}
                placeholder={initial.openaiTranscriptionKeySet ? '•••••••• (unchanged)' : ''}
                className="font-mono"
              />
            )}
          </Field>
        </ConnectionCard>

        {error ? (
          <Micro id={errId} role="alert" className="block text-rose">
            {error}
          </Micro>
        ) : null}
      </div>

      {/* RAIL — one combined note */}
      <div className="flex flex-col gap-4">
        <SettingsAccessNote body={CONNECTIONS_NOTE} icon={<KeyRound />} />
      </div>
    </div>
  );
}
