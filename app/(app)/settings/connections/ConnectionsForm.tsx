'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Field,
  Input,
  Badge,
  Micro,
} from '@/components/ui';
import { KeyRound } from 'lucide-react';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import type { MetricCardProps } from '@/components/ui/metric-card';
import { FormPanel } from '@/components/patterns';

const DEFAULT_MMA_BASE_URL = 'http://127.0.0.1:7337';

const CONNECTIONS_NOTE = `### Org secrets

- **MMA** — the local engine every team runs through
- **Speech-to-text** — optional voice transcription

### Storage

- **Encrypted** — shown only as set / not set, never sent to the browser
- **Git token** — team-owned; set it under Team settings`;

export interface ConnectionsData {
  mmaBaseUrl: string | null;
  openaiTranscriptionKeySet: boolean;
}

// Git token is team-owned (edited under Team settings) — the org connection
// surface handles only the MMA engine and the org voice/transcription key.
type Conn = 'mma' | 'openai';
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
 * Org connections form: MMA (the local engine — base URL + an optional advanced
 * bearer for a remote MMA) and Speech-to-text (OpenAI key) — each its own card
 * with read-on-load → Edit → Validate · Save. Token inputs are write-only;
 * sections save independently via PUT /api/connections. The team git token is
 * managed separately under Team settings.
 */
export function ConnectionsForm({
  initial,
  mmaBearer,
  metrics,
}: {
  initial: ConnectionsData;
  /** The auto-resolved local mma token (read-only display); null if none. */
  mmaBearer: string | null;
  metrics?: MetricCardProps[];
}) {
  const router = useRouter();
  const [mmaBaseUrl, setMmaBaseUrl] = useState(initial.mmaBaseUrl ?? DEFAULT_MMA_BASE_URL);
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
    <StageShell
      scroll="outer"
      metrics={metrics}
      align="start"
      note={<RailNote icon={<KeyRound />}>{CONNECTIONS_NOTE}</RailNote>}
    >
      <div className="flex flex-col gap-4">
        {/* MMA — the local engine; bearer auto-resolved, advanced only for remote */}
        <FormPanel
          heading="MMA"
          ariaLabel="MMA connection"
          indicator={<SetIndicator set={mmaBearer !== null} testid="mma-token-indicator" />}
          disclosure={{
            open: open === 'mma',
            summary: mmaBaseUrl,
            onEdit: () => edit('mma'),
          }}
          busy={busy === 'mma'}
          validate={{
            validating: validating === 'mma',
            result: open === 'mma' ? validateResult : null,
            onValidate: () => validate('mma'),
          }}
          onCancel={cancel}
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
          <Field label="Bearer token" hint="auto — managed by your local mma; read-only here">
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
        </FormPanel>

        {/* Speech-to-text (OpenAI key) */}
        <FormPanel
          heading="Speech to text"
          ariaLabel="Speech to text"
          indicator={<SetIndicator set={initial.openaiTranscriptionKeySet} testid="openai-key-indicator" />}
          disclosure={{
            open: open === 'openai',
            summary: 'OpenAI key for voice notes — transcribes speech into text (optional)',
            onEdit: () => edit('openai'),
          }}
          busy={busy === 'openai'}
          validate={{
            validating: validating === 'openai',
            result: open === 'openai' ? validateResult : null,
            onValidate: () => validate('openai', openaiKey),
          }}
          onCancel={cancel}
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
        </FormPanel>

        {error ? (
          <Micro id={errId} role="alert" className="block text-rose">
            {error}
          </Micro>
        ) : null}
      </div>
    </StageShell>
  );
}
