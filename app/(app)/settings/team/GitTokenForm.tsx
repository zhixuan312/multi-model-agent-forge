'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, Input } from '@/components/ui';
import { FormPanel, SetIndicator } from '@/components/patterns/form-panel';
import { responseError } from '@/lib/err';

/**
 * Team settings → git token (FR-6/FR-9). Sets/rotates the team's git credential
 * via PUT /api/connections (updateConnections writes `team.git_token_ref`). The
 * value is write-only — the server stores it encrypted and only ever reports
 * set / not set. Read-on-load credential card → Edit → Save, matching the org
 * connection cards.
 *
 * Validate matches them too. `POST /api/connections/validate` has always accepted
 * `type: 'git'` and `probeGit` has always been implemented and tested — this card just never
 * called it, so the whole git branch of that endpoint was unreachable from the app while its
 * two siblings (MMA, OpenAI) each had a button. This is the credential that clones every
 * repository and opens every PR: a bad one surfaces much later as "execute finished and no
 * PR appeared", which `createBuildPr` reports as no token being configured at all.
 */
export function GitTokenForm({ tokenSet }: { tokenSet: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const cancel = () => {
    setOpen(false);
    setToken('');
    setError(null);
    setValidateResult(null);
  };

  /**
   * Check the token against the git host. Sends the TYPED token when there is one so an
   * admin can test before saving; with the field empty the server falls back to the stored
   * one, which is how you check whether the existing credential still works.
   */
  const validate = async () => {
    setError(null);
    setValidateResult(null);
    setValidating(true);
    try {
      const res = await fetch('/api/connections/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'git', ...(token.trim() ? { token: token.trim() } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; detail?: string; message?: string } | null;
      if (!res.ok || !body) {
        setValidateResult({ ok: false, detail: body?.message ?? 'Could not run the check.' });
        return;
      }
      setValidateResult({ ok: !!body.ok, detail: body.detail ?? '' });
    } catch {
      setValidateResult({ ok: false, detail: 'Could not reach the server.' });
    } finally {
      setValidating(false);
    }
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
        setError(await responseError(res, 'Could not save the git token.'));
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
    <FormPanel
      heading="Git token"
      ariaLabel="Git token"
      indicator={<SetIndicator set={tokenSet} />}
      disclosure={{
        open,
        summary: 'Clones and pulls every repository for this team',
        onEdit: () => {
          setError(null);
          setValidateResult(null);
          setOpen(true);
        },
      }}
      busy={busy}
      validate={{ validating, result: validateResult, onValidate: () => void validate() }}
      saveLabel="Save token"
      canSave={token.trim() !== ''}
      error={error}
      onCancel={cancel}
      onSubmit={submit}
    >
      <Field
        label="Service token"
        hint={tokenSet ? 'Saving replaces the current token.' : 'A personal access token with repo read access.'}
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setValidateResult(null);
            }}
            className="font-mono"
          />
        )}
      </Field>
    </FormPanel>
  );
}
