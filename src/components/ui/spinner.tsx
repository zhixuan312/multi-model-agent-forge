import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/** Spinner — a spinning lucide Loader2 for indeterminate loading. */
const spinnerVariants = cva('animate-spin text-accent', {
  variants: {
    size: { sm: 'size-4', md: 'size-5', lg: 'size-7' },
  },
  defaultVariants: { size: 'md' },
});

export interface SpinnerProps extends VariantProps<typeof spinnerVariants> {
  className?: string;
  label?: string;
}

export function Spinner({ size, className, label = 'Loading' }: SpinnerProps) {
  return (
    <Loader2 role="status" aria-label={label} className={cn(spinnerVariants({ size }), className)} />
  );
}
