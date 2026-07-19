import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Badge, Card, CardContent, Eyebrow } from '@/components/ui';
import { ProseBlock } from '@/components/patterns/prose-block';

export function FeatureRail({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-4', className)}>{children}</div>;
}

export interface RailNoteProps {
  icon: ReactNode;
  title?: string;
  children: string;
  className?: string;
}

export function RailNote({ icon, title, children, className }: RailNoteProps) {
  return (
    // `items-start` deliberately: the note body runs to many lines, and an icon centred
    // against a long block would float in the middle of the paragraph.
    <div className={cn('flex items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4', className)}>
      <span
        aria-hidden
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent [&>svg]:size-5"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <Eyebrow as="h3" className="mb-2 text-ink">{title}</Eyebrow> : null}
        <ProseBlock variant="rail">{children}</ProseBlock>
      </div>
    </div>
  );
}

export interface RailCardProps {
  title: string;
  badge?: number;
  children: ReactNode;
  className?: string;
}

export function RailCard({ title, badge, children, className }: RailCardProps) {
  return (
    <Card className={className}>
      <CardContent>
        <div className="flex items-center gap-2">
          <Eyebrow as="h3" className="text-ink-faint">{title}</Eyebrow>
          {badge != null && badge > 0 ? <Badge variant="amber" size="sm">{badge}</Badge> : null}
        </div>
        <div className="mt-2.5">{children}</div>
      </CardContent>
    </Card>
  );
}

export interface RailStatusItem {
  id: string;
  label: string;
  status: string;
  detail?: string;
  error?: string;
  tone?: 'idle' | 'run' | 'done' | 'fail';
}

const TONE_VARIANT: Record<string, 'neutral' | 'amber' | 'sage' | 'rose'> = {
  idle: 'neutral',
  run: 'amber',
  done: 'sage',
  fail: 'rose',
};

export interface RailStatusProps {
  items: RailStatusItem[];
  emptyText?: string;
  live?: boolean;
  className?: string;
}

export function RailStatus({ items, emptyText, live, className }: RailStatusProps) {
  return (
    <section aria-label="Status" className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div
        aria-live={live ? 'polite' : undefined}
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        {items.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-faint">{emptyText ?? 'No items.'}</p>
        ) : (
          items.map((t) => {
            const variant = TONE_VARIANT[t.tone ?? 'idle'] ?? 'neutral';
            return (
              // Two columns: the status badge is one cell, the label + detail stack the
              // other, so the badge centres against the stack rather than pinning to line one.
              <div key={t.id} className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
                <Badge variant={variant} size="sm" className="shrink-0">{t.status}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{t.label}</p>
                  {t.detail ? <p className="truncate text-xs text-ink-soft">{t.detail}</p> : null}
                  {t.error ? <p className="mt-1 text-[11px] text-[var(--rose)]">{t.error}</p> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
