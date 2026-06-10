import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';

/**
 * IconButton — a square action holding a single lucide icon. Built on
 * `buttonVariants({ size: 'icon' })` so it inherits every Button variant +
 * state. `aria-label` is REQUIRED (an icon alone has no accessible name).
 */
export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    Pick<VariantProps<typeof buttonVariants>, 'variant'> {
  'aria-label': string;
  icon: ReactNode;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant = 'ghost', icon, loading, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size: 'icon' }), className)}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : <span aria-hidden className="inline-flex">{icon}</span>}
    </button>
  );
});
