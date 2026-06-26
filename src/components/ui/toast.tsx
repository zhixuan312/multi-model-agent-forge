'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Toast notification system — global, transient alerts.
 * Success auto-dismisses after 3s. Error persists until dismissed.
 * Renders at the app shell level (fixed bottom-right).
 */

export interface ToastItem {
  id: string;
  type: 'success' | 'error';
  message: string;
  retry?: () => void;
}

let nextId = 0;
const listeners = new Set<() => void>();
let items: ToastItem[] = [];

function emit() {
  for (const l of listeners) l();
}

export function showToast(toast: Omit<ToastItem, 'id'>): void {
  const id = `toast-${++nextId}`;
  items = [...items, { ...toast, id }];
  emit();
  if (toast.type === 'success') {
    setTimeout(() => dismissToast(id), 3000);
  }
}

export function dismissToast(id: string): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

function useToasts(): ToastItem[] {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return items;
}

export function Toaster() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useCallback(() => dismissToast(toast.id), [toast.id]);
  const isError = toast.type === 'error';

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[var(--r-md)] border px-4 py-3 shadow-lg animate-rise',
        isError
          ? 'border-[var(--rose)]/30 bg-rose-tint text-ink'
          : 'border-[var(--sage)]/30 bg-sage-tint text-ink',
      )}
      style={{ minWidth: 280, maxWidth: 400 }}
    >
      {isError ? (
        <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--rose)]" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--sage)]" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.message}</p>
        {toast.retry ? (
          <button
            type="button"
            onClick={() => { dismiss(); toast.retry!(); }}
            className="mt-1 text-xs font-medium text-accent-deep underline hover:text-accent"
          >
            Retry
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded p-0.5 text-ink-faint hover:text-ink"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
