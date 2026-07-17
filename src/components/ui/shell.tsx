import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Title, Text } from '@/components/ui/typography';
import { Breadcrumb, type Crumb } from '@/components/ui/breadcrumb';

/**
 * Forge app shell — the locked dashboard frame.
 *
 *   AppShell            full-viewport, never scrolls as a whole
 *   ├─ sidebar          fixed rail, own scroll
 *   └─ content column   flex-col, overflow-hidden — does NOT scroll
 *        ShellHeader    static row  — permanent header
 *        ShellSubNav    static row  — optional second nav (some screens)
 *        ShellBody      flex-1, overflow-y-auto — the ONLY scroll region
 *
 * The header/sub-nav are STATIC flex rows OUTSIDE the scroll region, and only
 * `ShellBody` scrolls. This is deliberate: a `position: sticky` header inside a
 * sub-scroller recomputes its offset on the main thread, so a fast fling can
 * out-run it for a frame before it snaps back (visible "header jitter"). With
 * the header physically outside the scrolling element, it cannot move at all —
 * jank-free by construction, not by compositor luck.
 */
export function AppShell({
  sidebar,
  mobileBar,
  topRight,
  children,
  className,
}: {
  sidebar: ReactNode;
  mobileBar?: ReactNode;
  /** Global utilities pinned to the top-right corner on desktop (notification
   *  bell + account menu), sitting in the page-header band above the scroll body. */
  topRight?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // `fixed inset-0` pins the whole frame to the viewport so the PAGE never
  // scrolls. The content column is a non-scrolling flex stack; ShellBody (a
  // flex child reached through the `display:contents` page chain) is the scroller.
  return (
    <div className={cn('app-bg fixed inset-0 isolate flex overflow-hidden', className)}>
      <div className="hidden h-full shrink-0 overflow-y-auto overscroll-contain lg:block">{sidebar}</div>
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        {mobileBar ? <div className="shrink-0 lg:hidden">{mobileBar}</div> : null}
        {topRight ? (
          // Pinned to the top-right corner, vertically centered in the h-16 header
          // band. z-30 keeps it above the page's own ShellHeader (z-20) so the
          // account menu / bell are always reachable.
          <div className="pointer-events-none absolute right-0 top-0 z-30 hidden h-16 items-center pr-5 md:pr-8 lg:flex">
            <div className="pointer-events-auto flex items-center gap-1">{topRight}</div>
          </div>
        ) : null}
        <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

/** Permanent header bar — a static row above the scroll region (never moves).
 *  `relative z-20` keeps header dropdowns (account / export menus) above the
 *  scrolling body, which is a later flex sibling. */
export function ShellHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'relative z-20 flex h-16 shrink-0 items-center gap-4 border-b border-line bg-surface px-5 md:px-8',
        // Reserve room on the right for the global top-right cluster (bell +
        // account menu) so a page's header actions don't slide under it (desktop).
        'lg:pr-32',
        className,
      )}
    >
      {children}
    </header>
  );
}

/** Optional secondary nav — a static row directly under the header. */
export function ShellSubNav({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative z-10 flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface-2 px-5 md:px-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The scroll region — the ONLY part of the frame that scrolls. Fills the height
 * left by the header/sub-nav (`flex-1 min-h-0`) and scrolls its own overflow;
 * `overflow-x-hidden` so a wide child can't add a horizontal scrollbar. The
 * inner element applies the reading max-width + padding so the scrollbar sits at
 * the content-column edge, not inside the text column.
 */
export function ShellBody({
  children,
  className,
  width = 'default',
  fill = false,
}: {
  children: ReactNode;
  className?: string;
  width?: 'default' | 'wide' | 'full';
  /** Full-height, non-scrolling page: the body fills the frame exactly and the
   *  page never scrolls — content manages its own internal scroll. */
  fill?: boolean;
}) {
  const max = width === 'full' ? 'max-w-none' : width === 'wide' ? 'max-w-[1320px]' : 'max-w-[1120px]';
  return (
    <div
      className={cn(
        'min-w-0 min-h-0 flex-1',
        fill ? 'overflow-hidden' : 'forge-scroll overflow-y-auto overflow-x-hidden overscroll-contain',
      )}
    >
      <div
        className={cn(
          'mx-auto w-full px-5 md:px-8',
          fill ? 'flex h-full flex-col py-5 md:py-6' : 'py-6 md:py-8',
          max,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The standard screen wrapper: a LOCKED header (serif title + actions) + an
 * optional locked sub-nav + a padded scroll body. Render this as the page root
 * inside the AppShell — every screen gets the permanent header for free.
 *
 *   <PageFrame title="Workspace" description="…" actions={<Button…/>}>…</PageFrame>
 *
 * For a fully custom header (e.g. the project topbar), pass `header` instead of
 * `title`; for a custom sub-nav (e.g. the stage stepper) pass `subnav`. Pass
 * `breadcrumb` to add the left-zone wayfinding trail above the title (e.g.
 * `[{ label: 'Projects', href: '/projects' }, { label: 'New project' }]`).
 *
 * The header follows a left→right grammar: the LEFT zone carries
 * breadcrumb + title (identity / wayfinding); the RIGHT zone carries `actions`
 * (the page's primary action + future global activity / search slots).
 */
export function PageFrame({
  title,
  breadcrumb,
  description,
  actions,
  header,
  subnav,
  children,
  width,
  fill = false,
}: {
  title?: ReactNode;
  breadcrumb?: Crumb[];
  description?: ReactNode;
  actions?: ReactNode;
  header?: ReactNode;
  subnav?: ReactNode;
  children: ReactNode;
  width?: 'default' | 'wide' | 'full';
  /** Full-height, non-scrolling page (the body fills the frame; content scrolls internally). */
  fill?: boolean;
}) {
  return (
    <>
      <ShellHeader>
        {header ?? (
          <>
            <div className="flex min-w-0 flex-col gap-0.5">
              {breadcrumb ? <Breadcrumb items={breadcrumb} /> : null}
              <Title className="min-w-0 truncate !text-xl !leading-tight">{title}</Title>
            </div>
            {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
          </>
        )}
      </ShellHeader>
      {subnav ? <ShellSubNav>{subnav}</ShellSubNav> : null}
      <ShellBody width={width} fill={fill}>
        {description ? <Text className="-mt-1 mb-6 max-w-[68ch]">{description}</Text> : null}
        {children}
      </ShellBody>
    </>
  );
}
