import type { ReactNode, Ref } from 'react';
import { Badge, Card, CardContent, CardTitle, TabBar } from '@/components/ui';

/**
 * DocumentShell — the shared stage-document shell: a constant header (title + version badge +
 * a bespoke segmented tab bar) and an optional approvers row, over a body that swaps by tab,
 * plus an optional footer (approve action / apply bar / composer). This is the canonical the
 * Spec / Plan / Journal document screens should all converge on. Content-agnostic — the body,
 * approvers, and footer are passed in.
 */
export interface DocumentShellTab {
  id: string;
  label: string;
}

export function DocumentShell({
  ariaLabel,
  title,
  meta,
  version,
  tabs,
  activeTab,
  onTabChange,
  headerAction,
  approvers,
  body,
  bodyRef,
  actions,
  footer,
  className,
}: {
  /** Accessible name when the visible title is not descriptive enough on its own. */
  ariaLabel?: string;
  title: ReactNode;
  /** Chips shown BEFORE the title — e.g. Plan's `Task 3`, Journal's `Learning 2` + category.
   *  Without this the numbered stages would have to hand-roll their own header again. */
  meta?: ReactNode;
  version?: number;
  tabs?: readonly DocumentShellTab[];
  activeTab?: string;
  /** When provided the tab bar is interactive; omit for a caller-driven (read-only) tab bar. */
  onTabChange?: (id: string) => void;
  /** Right-side header content when there are no tabs — e.g. Explore's "Text · voice · files"
   *  hint. Ignored when `tabs` is set, since the tab bar owns that side. */
  headerAction?: ReactNode;
  approvers?: ReactNode;
  body: ReactNode;
  /** Ref to the SCROLL container. The shell owns scrolling, so a consumer that scrolls the
   *  document (e.g. back to top when switching task) must attach here, not to its own div. */
  bodyRef?: Ref<HTMLDivElement>;
  /** Buttons for the standard right-aligned action row (Approve / Revoke). The shell draws
   *  the row so consumers stop re-spelling `justify-end … border-t … px-5 py-3`. */
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className} aria-label={ariaLabel}>
      {/* min-h-0 + flex-1 so a scrolling body can fill the card when the caller makes it a
          flex column (every stage surface does). Inert when the Card is not a flex parent. */}
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {meta}
            {/* CardTitle, not a bespoke <p> — every other card header in the app uses it, and
                hand-rolling one here made document headers a different face and weight. */}
            <CardTitle className="truncate">{title}</CardTitle>
            {version != null ? <Badge variant="sage" size="sm">v{version}</Badge> : null}
          </div>
          {tabs && tabs.length > 0 ? (
            <TabBar tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
          ) : (
            headerAction
          )}
        </div>
        {approvers}
        {/* The body scrolls, always — every tab (document, audit, discussion) can outgrow the
            card, and the header/approvers/footer must stay put while it does. Its padding and
            tint are owned here too: consumers had drifted across five spellings of the same
            surface, which is exactly what a governed shell exists to prevent. */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 px-5 py-5">
          {body}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            {actions}
          </div>
        ) : null}
        {footer}
      </CardContent>
    </Card>
  );
}
