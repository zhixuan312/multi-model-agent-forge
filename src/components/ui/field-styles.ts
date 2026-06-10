/**
 * Shared visual contract for text-like form controls (Input / Textarea / Select).
 * Centralised so every control reads identically: same surface, border, radius,
 * focus ring, invalid state, disabled state, and placeholder tone.
 */
export const fieldBase =
  'focus-ring w-full rounded-[var(--r)] border border-line-strong bg-surface text-sm text-ink ' +
  'transition-[border-color,box-shadow,background] duration-150 ease-[var(--ease-out)] ' +
  'placeholder:text-ink-faint hover:border-ink-faint ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-faint disabled:opacity-70 ' +
  'aria-[invalid=true]:border-rose aria-[invalid=true]:hover:border-rose';

/** Single-line height matches Button md (h-9). */
export const fieldSingleLine = 'h-9 px-3';
