import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Button — the single source of truth for actions. `buttonVariants` is exported
 * so an `<a>` (link-as-button) gets the exact same look:
 *   <a className={buttonVariants({ variant: 'primary' })}>…</a>
 */
export const buttonVariants = cva(
  // base: layout, type, motion, focus — shared by every variant
  'focus-ring relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r)] font-medium transition-[background,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-white shadow-sm hover:bg-accent-deep hover:shadow [text-shadow:0_1px_0_rgba(0,0,0,0.08)]',
        secondary:
          'border border-line-strong bg-surface text-ink shadow-sm hover:border-ink-faint hover:bg-surface-2',
        subtle: 'bg-surface-2 text-ink hover:bg-bg-sunk',
        ghost: 'text-ink-soft hover:bg-surface-2 hover:text-ink',
        danger: 'bg-rose text-white shadow-sm hover:brightness-95',
        link: 'h-auto rounded-none p-0 text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        md: 'h-9 px-4 text-sm [&_svg]:size-4',
        lg: 'h-11 px-5 text-[15px] [&_svg]:size-[18px]',
        icon: 'size-9 [&_svg]:size-[18px]',
      },
      fullWidth: { true: 'w-full' },
    },
    compoundVariants: [{ variant: 'link', size: ['sm', 'md', 'lg'], class: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, fullWidth, leftIcon, rightIcon, loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : leftIcon ? (
        <span className="-ml-0.5 inline-flex" aria-hidden>
          {leftIcon}
        </span>
      ) : null}
      {children}
      {rightIcon && !loading ? (
        <span className="-mr-0.5 inline-flex" aria-hidden>
          {rightIcon}
        </span>
      ) : null}
    </button>
  );
});
