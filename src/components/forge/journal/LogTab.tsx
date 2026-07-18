'use client';

import { useRouter } from 'next/navigation';
import { History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';
import { WriteLogView } from '@/components/forge/journal/WriteLogView';
import { RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import type { LogEntry } from '@/journal/types';

/** Rail note for the Log tab — describes the write log itself (not the graph). */
const LOG_NOTE = `### Write log

- **Append-only** — one line per journal write, in order
- **Each entry** — the operation, the node id, and its title

### Operations

- **Create** — a new node was recorded
- **Refine** — a node was updated in place
- **Supersede** — a node replaced an older one
- **Merge** — nodes were combined into one`;

/**
 * The Log tab — the append-only event log on the 2/3 canvas, with a note in the
 * rail describing the log. Clicking an entry's node id opens it in the Nodes tab.
 */
export function LogTab({ log }: { log: LogEntry[] }) {
  const router = useRouter();
  const onNavigate = (id: string) => router.push(`/journal?view=nodes&node=${id}`);

  return (
    <StatusDashboard
      aside={<RailNote icon={<History />}>{LOG_NOTE}</RailNote>}
      primary={
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <WriteLogView log={log} onNavigate={onNavigate} />
          </CardContent>
        </Card>
      }
    />
  );
}
