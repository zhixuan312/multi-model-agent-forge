'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Dialog — the canonical shadcn/Radix dialog, themed to Forge. Compose it the
 * framework way:
 *
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>…</DialogTitle>
 *         <DialogDescription>…</DialogDescription>
 *       </DialogHeader>
 *       …
 *       <DialogFooter>…</DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * Radix handles the portal, scroll-lock, focus trap, Escape, and aria wiring.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('forge-overlay fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm', className)}
      {...props}
    />
  );
}

export interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** Hide the built-in top-right close button. */
  hideClose?: boolean;
}

export function DialogContent({ className, children, hideClose, ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'forge-pop fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-0',
          'overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop)]',
          'focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className="focus-ring absolute right-4 top-4 grid size-7 place-items-center rounded-[var(--r-sm)] text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
            aria-label="Close"
          >
            <X aria-hidden />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 px-6 pt-5', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'mt-5 flex items-center justify-end gap-2.5 border-t border-line bg-surface-2/60 px-6 py-3.5',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('t-title !text-xl', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('t-body', className)} {...props} />;
}

/** Body region — standard horizontal padding for content between header/footer. */
export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-6 pt-4', className)} {...props} />;
}
