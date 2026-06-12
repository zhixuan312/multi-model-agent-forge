'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

/**
 * Tabs — the canonical shadcn/Radix tab set, themed to Forge (ember underline on
 * the active trigger). Radix provides roving focus + the WAI-ARIA tabs pattern.
 * Drive it with `value` / `onValueChange`, or `defaultValue` for uncontrolled.
 *
 *   <Tabs value={v} onValueChange={setV}>
 *     <TabsList>
 *       <TabsTrigger value="a">A</TabsTrigger>
 *       <TabsTrigger value="b">B</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="a">…</TabsContent>
 *   </Tabs>
 */
export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col', className)} {...props} />;
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex items-stretch gap-1 border-b border-line', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'focus-ring group relative -mb-px inline-flex items-center gap-2 whitespace-nowrap rounded-t-[var(--r-sm)] px-3.5 py-2 text-sm font-medium',
        'transition-colors duration-150 ease-[var(--ease-out)]',
        'disabled:pointer-events-none disabled:opacity-50',
        'text-ink-faint hover:text-ink-soft data-[state=active]:text-ink',
        '[&_svg]:size-4',
        className,
      )}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-transparent opacity-0 transition-[background,opacity] duration-150 ease-[var(--ease-out)] group-data-[state=active]:bg-accent group-data-[state=active]:opacity-100"
      />
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('focus-ring pt-4', className)} {...props} />;
}
