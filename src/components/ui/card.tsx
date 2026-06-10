import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Title, Text } from '@/components/ui/typography';

/**
 * Card — the standard surface. `header`/`footer` slots sit on a sunk band so
 * actions and titles read as distinct zones from the body. Compose with
 * `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`.
 */
const cardVariants = cva('overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface', {
  variants: {
    elevation: { flat: '', raised: 'shadow-sm', floating: 'shadow-lg' },
    interactive: { true: 'transition-shadow duration-150 ease-[var(--ease-out)] hover:shadow' },
  },
  defaultVariants: { elevation: 'raised' },
});

export function Card({
  className,
  elevation,
  interactive,
  ...rest
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ elevation, interactive }), className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-5 py-3.5', className)}
      {...rest}
    />
  );
}

export function CardTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <Title as="h2" className={cn('!text-base', className)} {...(rest as object)}>
      {children}
    </Title>
  );
}

export function CardDescription({ className, children, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <Text className={cn('t-sm', className)} {...(rest as object)}>
      {children}
    </Text>
  );
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 border-t border-line bg-surface-2/60 px-5 py-3', className)}
      {...rest}
    />
  );
}
