'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Dialog — a modal overlay. Controlled via `open` / `onOpenChange`. It locks
 * body scroll while open, closes on Escape and backdrop click, and moves focus
 * into the panel on open. `DialogTitle` / `DialogDescription` auto-wire
 * `aria-labelledby` / `aria-describedby`.
 *
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogPanel>
 *       <DialogTitle>…</DialogTitle>
 *       <DialogDescription>…</DialogDescription>
 *       <DialogFooter>…</DialogFooter>
 *     </DialogPanel>
 *   </Dialog>
 */
interface DialogCtx {
  onOpenChange: (v: boolean) => void;
  titleId: string;
  descId: string;
}
const DialogContext = createContext<DialogCtx | null>(null);

function useDialog(component: string): DialogCtx {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error(`<${component}> must be used inside <Dialog>`);
  return ctx;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const base = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    // Move focus to the first focusable element, else the panel itself.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panelRef.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
      prevFocus?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <DialogContext.Provider
      value={{ onOpenChange, titleId: `${base}-title`, descId: `${base}-desc` }}
    >
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
        onMouseDown={(e) => {
          if (e.target === overlayRef.current) onOpenChange(false);
        }}
      >
        <DialogPanelInner panelRef={panelRef}>{children}</DialogPanelInner>
      </div>
    </DialogContext.Provider>
  );
}

// Internal: lets Dialog hand the panel ref down without exposing it on the API.
function DialogPanelInner({
  panelRef,
  children,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return <PanelRefContext.Provider value={panelRef}>{children}</PanelRefContext.Provider>;
}
const PanelRefContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

export function DialogPanel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const { titleId, descId } = useDialog('DialogPanel');
  const panelRef = useContext(PanelRefContext);
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
      className={cn(
        'animate-rise focus-ring w-full max-w-lg overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function DialogTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialog('DialogTitle');
  return (
    <h2 id={titleId} className={cn('t-title px-6 pt-5 !text-xl', className)} {...rest}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  const { descId } = useDialog('DialogDescription');
  return (
    <p id={descId} className={cn('t-body px-6 pt-2', className)} {...rest}>
      {children}
    </p>
  );
}

export function DialogFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-5 flex items-center justify-end gap-2.5 border-t border-line bg-surface-2/60 px-6 py-3.5',
        className,
      )}
      {...rest}
    />
  );
}
