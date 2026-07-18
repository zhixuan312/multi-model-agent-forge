import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Badge, Card, CardContent } from '@/components/ui';

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
  title,
  version,
  tabs,
  activeTab,
  onTabChange,
  approvers,
  body,
  footer,
  className,
}: {
  title: ReactNode;
  version?: number;
  tabs?: readonly DocumentShellTab[];
  activeTab?: string;
  /** When provided the tab bar is interactive; omit for a caller-driven (read-only) tab bar. */
  onTabChange?: (id: string) => void;
  approvers?: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col p-0">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-ink">{title}</p>
            {version != null ? <Badge variant="sage" size="sm">v{version}</Badge> : null}
          </div>
          {tabs && tabs.length > 0 ? (
            <div role="tablist" className="flex items-center rounded-[var(--r)] border border-line bg-surface-2 p-0.5">
              {tabs.map((t) =>
                onTabChange ? (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.id}
                    onClick={() => onTabChange(t.id)}
                    className={cn(
                      'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors',
                      activeTab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
                    )}
                  >
                    {t.label}
                  </button>
                ) : (
                  <span
                    key={t.id}
                    className={cn(
                      'rounded-[6px] px-3 py-1 text-xs font-medium',
                      activeTab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint',
                    )}
                  >
                    {t.label}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </div>
        {approvers}
        {body}
        {footer}
      </CardContent>
    </Card>
  );
}
