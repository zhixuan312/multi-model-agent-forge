'use client';

import {
  createContext,
  useContext,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Tabs — a controlled tab set. Drive it with `value` / `onValueChange`. The
 * active trigger carries an ember underline indicator; ArrowLeft/Right (and
 * Home/End) move focus+selection along the list, per the WAI-ARIA tabs pattern.
 *
 *   <Tabs value={v} onValueChange={setV}>
 *     <TabsList>
 *       <TabsTrigger value="a">A</TabsTrigger>
 *       <TabsTrigger value="b">B</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="a">…</TabsContent>
 *     <TabsContent value="b">…</TabsContent>
 *   </Tabs>
 */
interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}
const TabsContext = createContext<TabsCtx | null>(null);

function useTabs(component: string): TabsCtx {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`);
  return ctx;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, className, children, ...rest }: TabsProps) {
  const baseId = useId();
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange, baseId }}>
      <div className={cn('flex flex-col', className)} {...rest}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    if (tabs.length === 0) return;
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    tabs[next]?.focus();
    tabs[next]?.click();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn('flex items-stretch gap-1 border-b border-line', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps
  extends Omit<HTMLAttributes<HTMLButtonElement>, 'value'> {
  value: string;
  disabled?: boolean;
}

export function TabsTrigger({ value, className, children, disabled, ...rest }: TabsTriggerProps) {
  const { value: active, setValue, baseId } = useTabs('TabsTrigger');
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        'focus-ring relative -mb-px inline-flex items-center gap-2 whitespace-nowrap rounded-t-[var(--r-sm)] px-3.5 py-2 text-sm font-medium',
        'transition-colors duration-150 ease-[var(--ease-out)]',
        'disabled:pointer-events-none disabled:opacity-50',
        selected ? 'text-ink' : 'text-ink-faint hover:text-ink-soft',
        '[&_svg]:size-4',
        className,
      )}
      {...rest}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-2.5 -bottom-px h-0.5 rounded-full transition-[background,opacity] duration-150 ease-[var(--ease-out)]',
          selected ? 'bg-accent opacity-100' : 'bg-transparent opacity-0',
        )}
      />
    </button>
  );
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...rest }: TabsContentProps) {
  const { value: active, baseId } = useTabs('TabsContent');
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn('focus-ring pt-4', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
