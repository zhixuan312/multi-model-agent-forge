import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, Badge, Eyebrow } from '@/components/ui';

/**
 * StageShell — the universal master-detail layout for all project stages.
 * Right rail (1/3): note + selectable item list + footer.
 * Left main (2/3): detail content for the selected item.
 *
 * Every stage follows the same pattern:
 * - Spec Craft: components list → Q&A conversation
 * - Plan Refine: tasks list → task conversation
 * - Explore Discover: agent tasks → task output/findings
 * - Review: passes → findings grid
 * - Journal: learnings → conversation + draft
 */

export interface StageShellItem {
  id: string;
  label: string;
  description?: string;
  status?: string;
  statusVariant?: 'neutral' | 'amber' | 'sage' | 'rose';
}

export interface StageShellProps {
  /** The guidance note at the top of the rail. */
  note?: ReactNode;
  /** The selectable items in the rail. */
  items: StageShellItem[];
  /** The currently selected item id. */
  activeId: string | null;
  /** Called when an item is selected. */
  onSelect: (id: string) => void;
  /** Rail list title (e.g. "Tasks", "Components", "Learnings"). */
  listTitle: string;
  /** Progress indicator next to the list title (e.g. "3/5"). */
  listProgress?: string;
  /** The main content area — renders detail for the selected item. */
  children: ReactNode;
  /** Footer content in the rail (e.g. StageAdvance button). */
  footer?: ReactNode;
  /** Additional content below the item list (e.g. action buttons). */
  listActions?: ReactNode;
  /** Extra className for the outer grid. */
  className?: string;
}

export function StageShell({
  note,
  items,
  activeId,
  onSelect,
  listTitle,
  listProgress,
  children,
  footer,
  listActions,
  className,
}: StageShellProps) {
  return (
    <div className={cn('grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch', className)}>
      {/* LEFT — main detail content (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        {children}
      </Card>

      {/* RIGHT — note + item list + footer (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        {note}
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>{listTitle}</CardTitle>
            {listProgress ? (
              <span className="text-sm font-medium text-ink-faint">{listProgress}</span>
            ) : null}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
            {items.map((item) => {
              const isActive = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
                    isActive
                      ? 'border-accent bg-surface shadow-sm'
                      : 'border-transparent hover:bg-surface-2/50',
                  )}
                >
                  {item.status ? (
                    <Badge
                      variant={item.statusVariant ?? 'neutral'}
                      size="sm"
                      className="mt-0.5 shrink-0"
                    >
                      {item.status}
                    </Badge>
                  ) : (
                    <span className={cn(
                      'mt-1.5 size-2.5 shrink-0 rounded-full',
                      isActive ? 'bg-accent' : 'bg-line-strong',
                    )} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{item.label}</p>
                    {item.description ? (
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{item.description}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
            {items.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-faint">No items yet.</p>
            ) : null}
          </CardContent>
          {(footer || listActions) ? (
            <CardFooter className="flex-col !items-stretch gap-2">
              {listActions}
              {footer}
            </CardFooter>
          ) : null}
        </Card>
      </aside>
    </div>
  );
}

/**
 * StageFullWidth — for phases that don't have a rail list
 * (e.g. Explore Brief, Spec Outline, Execute Configure).
 * Full-width main content with optional rail note + sidebar content.
 */
export interface StageFullWidthProps {
  note?: ReactNode;
  children: ReactNode;
  sidebar?: ReactNode;
  className?: string;
}

export function StageFullWidth({ note, children, sidebar, className }: StageFullWidthProps) {
  return (
    <div className={cn('grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch', className)}>
      <div className="flex min-h-0 flex-col lg:col-span-2">
        {children}
      </div>
      <aside className="flex min-h-0 flex-col gap-4">
        {note}
        {sidebar}
      </aside>
    </div>
  );
}
