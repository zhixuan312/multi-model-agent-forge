'use client';

import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { Label } from '@/components/ui/typography';

/**
 * AvatarPicker — the live avatar preview beside its colour swatches. A labelled radiogroup:
 * each swatch is the Avatar's own tint chip (same colour-mix background) minus the initials,
 * so the colour you click is exactly the avatar's background.
 *
 * Sits inside a `FormPanel` as a field-like row, above the text fields.
 */

/** Avatar tint palette (warm-world accents from forge.css). The trailing `#9a6b4f` is the DB
 *  default tint (lowercase, as stored) so a member who never picked a colour still shows a
 *  selected swatch. */
export const AVATAR_TINTS = [
  '#6A6F8C',
  '#5E7C6B',
  '#9A6A8C',
  '#C4521E',
  '#355A74',
  '#8A7A5E',
  '#9a6b4f',
] as const;

export function AvatarPicker({
  initials,
  value,
  onChange,
  label = 'Avatar colour',
  tints = AVATAR_TINTS,
}: {
  /** Initials shown in the live preview avatar. */
  initials: string;
  /** Currently selected tint (hex, as stored). */
  value: string;
  onChange: (tint: string) => void;
  label?: string;
  tints?: readonly string[];
}) {
  return (
    <div className="flex items-center gap-4">
      <Avatar size="lg" initials={initials} tint={value} aria-hidden />
      <div className="flex flex-col gap-1.5">
        <Label as="span">{label}</Label>
        <div role="radiogroup" aria-label={label} className="flex gap-2">
          {tints.map((t) => (
            <button
              type="button"
              key={t}
              role="radio"
              aria-checked={t === value}
              aria-label={`${label} ${t}`}
              onClick={() => onChange(t)}
              className={cn(
                // inline-flex + p-0 so the button box hugs the 24px chip exactly (no UA
                // padding) → the selection ring stays circular.
                'focus-ring inline-flex rounded-full p-0 transition-transform hover:scale-110',
                t === value && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
              )}
            >
              <Avatar size="sm" initials="" tint={t} aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
