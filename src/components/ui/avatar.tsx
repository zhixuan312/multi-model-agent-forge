import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Avatar — initials on a tinted chip. Pass `name` (initials are derived) or an
 * explicit `initials` string. `tint` is a hex used to mix a soft background +
 * matching foreground via `color-mix`, so any team color drops in without new
 * tokens. Defaults to the ember accent tint.
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

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).slice(0, 2);
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
      aria-label={name ?? undefined}
      {...rest}
    >
      {text}
    </span>
  );
}
