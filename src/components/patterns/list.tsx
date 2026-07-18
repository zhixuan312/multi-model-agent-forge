import type { ReactNode } from 'react';
import { Card, CardContent, Eyebrow } from '@/components/ui';

/**
 * List — the shared left-panel list container: a card holding one or more sections, each an
 * optional `header` (Eyebrow) over `divide-y` rows. Each row has a leading slot (icon / expand
 * arrow), primary (+ optional secondary) text, and a trailing slot (badge / count). Content-
 * agnostic — callers pass whatever fills the slots; the container shape is what's governed.
 */
export interface ListRow {
  id: string;
  leading?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
}

export interface ListSection {
  header?: ReactNode;
  rows: readonly ListRow[];
}

export function List({ sections, className }: { sections: readonly ListSection[]; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4 py-4">
        {sections.map((section, i) => (
          <section key={i} className="flex flex-col gap-2">
            {section.header ? <Eyebrow className="text-ink-faint">{section.header}</Eyebrow> : null}
            <ul className="flex flex-col divide-y divide-line">
              {section.rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-3 text-sm">
                  {row.leading}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{row.primary}</p>
                    {row.secondary ? <p className="text-xs text-ink-faint">{row.secondary}</p> : null}
                  </div>
                  {row.trailing}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
