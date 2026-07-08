'use client';

import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Card, CardContent, Button, TextStrong, Micro } from '@/components/ui';
import { VerifyResultBox } from '@/components/forge/VerifyResultBox';

export interface SettingCardValidate {
  validating: boolean;
  result: { ok: boolean; detail: string } | null;
  onValidate: () => void;
}

/**
 * One setting in its own card — the shared credential-style surface used across
 * Org connections (MMA, Speech-to-text) and Team settings (git token, workspace
 * path). Read view on load (title + indicator/summary + Edit); clicking Edit
 * opens an inline form (fields + Cancel · [Validate] · Save). Passing `validate`
 * adds the live-check button (connections); omit it for plain save (git token,
 * workspace).
 */
export function SettingCard({
  title,
  indicator,
  summary,
  ariaLabel,
  open,
  busy,
  saveLabel = 'Save',
  canSave = true,
  validate,
  error,
  onEdit,
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  indicator?: ReactNode;
  summary?: ReactNode;
  ariaLabel: string;
  open: boolean;
  busy: boolean;
  /** Submit-button label (default "Save"). */
  saveLabel?: string;
  /** Gate the submit button (default enabled). */
  canSave?: boolean;
  /** Optional live-connection check (renders the Validate button + result box). */
  validate?: SettingCardValidate;
  /** Optional inline error, shown above the footer inside the open form. */
  error?: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
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
            {validate?.result ? (
              <VerifyResultBox ok={validate.result.ok}>
                <Micro className="block !text-ink-soft">{validate.result.detail}</Micro>
              </VerifyResultBox>
            ) : null}
            {error ? (
              <Micro role="alert" className="block text-rose">
                {error}
              </Micro>
            ) : null}
            <div className="flex items-center justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
              {validate ? (
                <Button type="button" variant="secondary" onClick={validate.onValidate} loading={validate.validating}>
                  {validate.validating ? 'Validating…' : 'Validate'}
                </Button>
              ) : null}
              <Button type="submit" loading={busy} disabled={!canSave}>
                {busy ? 'Saving…' : saveLabel}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
