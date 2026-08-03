import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Avatar — initials on a tinted chip. Pass `name` (initials are derived) or an
 * explicit `initials` string. `tint` is a hex used to mix a soft background +
 * matching foreground via `color-mix`, so any team color drops in without new
 * tokens. Defaults to the ember accent tint.
 *
 * NAMING IS THE CALLER'S JOB. This renders a `<span>`, which maps to the
 * `generic` role, and ARIA prohibits naming a generic element — so an
 * `aria-label` here is silently discarded by every browser. It used to set one
 * from `name`, which read as "accessibility handled" while reaching no screen
 * reader; every call site had already worked around it. Supply the name one of
 * three ways, all of which are in use:
 *
 *   - adjacent text + `aria-hidden` on the avatar (the common case)
 *   - a `title` attribute, which IS a valid name source on a span
 *   - a Tooltip wrapper that names the trigger
 */
const avatarVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium uppercase leading-none',
  {
    variants: {
      size: {
        sm: 'size-6 text-[0.625rem]',
        md: 'size-9 text-xs',
        lg: 'size-12 text-base',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

/**
 * Two-letter initials from a display name ("Maya Adeyemi" → "MA").
 *
 * Exported because callers that pass `initials` directly — the profile form feeding
 * `AvatarPicker`, which has no `name` prop — need the same rule. It previously lived a
 * second time in `components/forge/avatar.ts` purely because this one was private.
 */
export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).slice(0, 2).toUpperCase();
}

export interface AvatarProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof avatarVariants> {
  name?: string;
  initials?: string;
  /** Hex seed for the tint chip; defaults to the ember accent. */
  tint?: string;
}

export function Avatar({ className, size, name, initials, tint, style, ...rest }: AvatarProps) {
  const text = (initials ?? (name ? deriveInitials(name) : '?')).toUpperCase();
  const seed = tint ?? 'var(--accent)';
  return (
    <span
      className={cn(avatarVariants({ size }), className)}
      style={{
        backgroundColor: `color-mix(in oklab, ${seed} 16%, var(--surface))`,
        color: `color-mix(in oklab, ${seed} 72%, var(--ink))`,
        ...style,
      }}
      {...rest}
    >
      {text}
    </span>
  );
}
