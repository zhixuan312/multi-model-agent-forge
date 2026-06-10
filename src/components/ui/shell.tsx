import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Forge app shell — the locked dashboard frame.
 *
 *   AppShell            full-viewport, never scrolls as a whole
 *   ├─ sidebar          fixed rail, own scroll
 *   └─ content column   flex-col; the scroll region is the ONLY thing that moves
 *        ShellHeader    sticky top-0  — permanent header
 *        ShellSubNav    sticky top    — optional second nav (some screens)
 *        …content…      scrolls
 *
 * Headers use `sticky` so they stay pinned to the top of the scroll region while
 * the body moves — the sidebar and header read as permanently locked.
 */
export function AppShell({
  sidebar,
  mobileBar,
  children,
  className,
}: {
  sidebar: ReactNode;
  mobileBar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // `fixed inset-0` pins the whole frame to the viewport so the PAGE never
  // scrolls — only the inner content surface does. Robust against any body /
  // dvh / min-height quirk.
  return (
    <div className={cn('fixed inset-0 flex overflow-hidden bg-bg', className)}>
      <div className="hidden h-full shrink-0 overflow-y-auto lg:block">{sidebar}</div>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {mobileBar ? <div className="shrink-0 lg:hidden">{mobileBar}</div> : null}
        {/* The single scroll surface. Header/sub-nav stick to its top. */}
        <div className="forge-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** Permanent header bar — sticks to the top of the scroll region. */
export function ShellHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-line bg-surface/85 px-5 backdrop-blur-md md:px-8',
        className,
      )}
    >
      {children}
    </header>
  );
}

/** Optional secondary nav — sits just under the header and sticks beneath it. */
export function ShellSubNav({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'sticky top-16 z-10 flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface-2/85 px-5 backdrop-blur-md md:px-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Padded content container with a sensible reading max-width. */
export function ShellBody({
  children,
  className,
  width = 'default',
}: {
  children: ReactNode;
  className?: string;
  width?: 'default' | 'wide' | 'full';
}) {
  const max = width === 'full' ? 'max-w-none' : width === 'wide' ? 'max-w-[1320px]' : 'max-w-[1120px]';
  return (
    <div className={cn('mx-auto w-full px-5 py-6 md:px-8 md:py-8', max, className)}>{children}</div>
  );
}

/**
 * Convenience composition for a standard screen: a locked header (title +
 * actions) + optional sub-nav + a padded scroll body. Render this as the page's
 * root inside the AppShell.
 */
export function PageFrame({
  header,
  subnav,
  children,
  width,
}: {
  header: ReactNode;
  subnav?: ReactNode;
  children: ReactNode;
  width?: 'default' | 'wide' | 'full';
}) {
  return (
    <>
      <ShellHeader>{header}</ShellHeader>
      {subnav ? <ShellSubNav>{subnav}</ShellSubNav> : null}
      <ShellBody width={width}>{children}</ShellBody>
    </>
  );
}
