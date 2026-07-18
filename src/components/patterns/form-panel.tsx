'use client';

import type { FormEvent, ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, Button, TextStrong, Micro, Mono } from '@/components/ui';
import { VerifyResultBox } from '@/components/forge/VerifyResultBox';

export interface FormPanelValidate {
  validating: boolean;
  result: { ok: boolean; detail: string } | null;
  onValidate: () => void;
}

/**
 * FormPanel — the one form shell in Forge. Every form is the same three parts: an optional
 * header, the fields, and a footer of actions. What used to look like three different
 * components was only ever two switches on top of that:
 *
 *   - `inline`     — drop the Card and tint the panel, for a form that opens inside a
 *                    DataTable row (`leadingRow` / `renderExpanded`). The table draws the
 *                    surrounding chrome, so a second Card would double-frame it.
 *   - `disclosure` — show a read view (summary + Edit) until opened. This is the settings
 *                    /credential behaviour: the saved value is described, never revealed.
 *
 * Pass neither and you get a plain always-open page form. No prop is ignored in any
 * combination — they compose.
 *
 * The footer is owned here on purpose: `Cancel · [Validate] · Save` right-aligned, with an
 * optional `destructive` slot on the left. Callers must not hand-roll it — eight different
 * spellings of `justify-end` / `justify-between` are what this replaced.
 *
 *   <FormPanel ariaLabel="Edit member" inline onSubmit={save} onCancel={done} busy={busy}
 *              destructive={<DeleteButton />}>
 *     <FieldGrid>…</FieldGrid>
 *   </FormPanel>
 */
export function FormPanel({
  ariaLabel,
  onSubmit,
  children,
  heading,
  indicator,
  leading,
  disclosure,
  inline = false,
  busy = false,
  saveLabel = 'Save',
  savingLabel,
  canSave = true,
  cancelLabel = 'Cancel',
  onCancel,
  validate,
  destructive,
  error,
  className,
}: {
  /** Accessible name for the <form> — say which record, e.g. "Edit member". */
  ariaLabel: string;
  onSubmit: () => void;
  /** The fields — stacked, or wrapped in a `FieldGrid` for two columns. */
  children: ReactNode;
  heading?: ReactNode;
  /** Status chip beside the heading (e.g. a "connected" Badge). */
  indicator?: ReactNode;
  /** Visual shown left of the heading in the READ view — e.g. the member's avatar. Only
   *  rendered while collapsed: once open, the editable control (AvatarPicker) is in the
   *  body, and showing both would duplicate it. */
  leading?: ReactNode;
  /** Read→edit disclosure. Omit for an always-open form. `summary` is the saved value as
   *  plain text — FormPanel styles it; do not wrap it in your own typography component. */
  disclosure?: { open: boolean; summary?: ReactNode; onEdit: () => void };
  /** Render tinted and Card-less, to sit inside a DataTable row. */
  inline?: boolean;
  busy?: boolean;
  saveLabel?: string;
  /** Submit label while busy (defaults to "Saving…"). */
  savingLabel?: string;
  canSave?: boolean;
  cancelLabel?: string;
  /** Omit to hide Cancel (e.g. a page form with only a Save). */
  onCancel?: () => void;
  /** Live-connection check — adds the Validate button and its result box. */
  validate?: FormPanelValidate;
  /** Left-aligned destructive action (and its confirm step), e.g. Delete. */
  destructive?: ReactNode;
  error?: string | null;
  className?: string;
}) {
  const open = disclosure ? disclosure.open : true;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  // The header is a two-column row: the left column stacks heading + summary, the right holds
  // Edit. `items-center` centres Edit against that whole stack instead of pinning it to the
  // first line, so it stays centred whether the summary is present or not.
  // The header is a two-column row: the left column stacks heading + summary, the right holds
  // Edit. `items-center` centres Edit against that whole stack instead of pinning it to the
  // first line, so it stays centred whether the summary is present or not.
  const header =
    heading != null || (disclosure && !open) ? (
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {disclosure && !open ? leading : null}
          <div className="min-w-0">
            {heading != null ? (
              <div className="flex items-center gap-2">
                <TextStrong className="!text-sm !text-ink">{heading}</TextStrong>
                {indicator}
              </div>
            ) : null}
            {disclosure && !open && disclosure.summary ? (
              // One style for every read view: mono at text-sm, because the summary is the
              // SAVED VALUE (a URL, a path, a handle). Callers pass text, not their own
              // <Micro>/<Mono> — four consumers had drifted across two families and two sizes.
              <Mono className="mt-1.5 block !text-sm text-ink-soft">{disclosure.summary}</Mono>
            ) : null}
          </div>
        </div>
        {disclosure && !open ? (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Pencil />}
            aria-label={typeof heading === 'string' ? `Edit ${heading}` : 'Edit'}
            onClick={disclosure.onEdit}
          >
            Edit
          </Button>
        ) : null}
      </div>
    ) : null;

  const form = open ? (
    <form
      aria-label={ariaLabel}
      onSubmit={submit}
      className={cn('flex flex-col gap-4', header && !inline && 'border-t border-line pt-4')}
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
      <div className="flex items-center gap-2.5">
        {destructive}
        <div className="ml-auto flex items-center gap-2.5">
          {onCancel ? (
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
          ) : null}
          {validate ? (
            <Button type="button" variant="secondary" onClick={validate.onValidate} loading={validate.validating}>
              {validate.validating ? 'Validating…' : 'Validate'}
            </Button>
          ) : null}
          <Button type="submit" loading={busy} disabled={!canSave}>
            {busy ? (savingLabel ?? 'Saving…') : saveLabel}
          </Button>
        </div>
      </div>
    </form>
  ) : null;

  // Inline forms sit inside a DataTable row, which already draws the surrounding chrome.
  if (inline) {
    return (
      <div className={cn('flex flex-col gap-4 bg-surface-2/50 p-4', className)}>
        {header}
        {form}
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4 py-5">
        {header}
        {form}
      </CardContent>
    </Card>
  );
}
