import { cn } from '@/lib/cn';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RESEARCH_SOURCES } from '@/content/direction-reference';

/**
 * The external sources the `research` route fans out across, as a table —
 * what each covers and whether it needs authentication. Web search is Brave.
 */
export function ResearchSources() {
  return (
    <div className="overflow-x-auto rounded-[var(--r-md)] border border-line">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Covers</TableHead>
            <TableHead className="w-32">Auth</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {RESEARCH_SOURCES.map((s) => (
            <TableRow key={s.name}>
              <TableCell className="py-2 align-top text-xs font-semibold text-ink">{s.name}</TableCell>
              <TableCell className="py-2 align-top text-xs leading-relaxed text-ink-soft">{s.covers}</TableCell>
              <TableCell
                className={cn('py-2 align-top text-xs', s.auth === '—' ? 'text-ink-faint' : 'text-ink-soft')}
              >
                {s.auth}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
