'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui';
import { WriteLogView } from '@/components/forge/journal/WriteLogView';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import { RailLayout } from '@/components/forge/journal/journal-shell';
import type { LogEntry } from '@/journal/types';

/**
 * The Write-log tab — the append-only event log on the 2/3 canvas, the journal
 * note in the rail. Clicking an entry's node id opens it in the Nodes tab.
 */
export function LogTab({ log }: { log: LogEntry[] }) {
  const router = useRouter();
  const onNavigate = (id: string) => router.push(`/journal?view=nodes&node=${id}`);

  return (
    <RailLayout rail={<JournalNote />}>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
          <WriteLogView log={log} onNavigate={onNavigate} />
        </CardContent>
      </Card>
    </RailLayout>
  );
}
