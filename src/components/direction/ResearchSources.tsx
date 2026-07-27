import { cn } from '@/lib/cn';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Mono, TextSm } from '@/components/ui/typography';
import { RESEARCH_SOURCES } from '@/content/direction-reference';

/**
 * The external sources the `research` route fans out across, as a table inside
 * the standard `Card` surface — what each covers and whether it needs
 * authentication. Web search is Brave.
 */
export function ResearchSources() {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
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
                  <TableCell className="align-top">
                    <Mono className="!text-xs font-medium !text-ink">{s.name}</Mono>
                  </TableCell>
                  <TableCell className="align-top">
                    <TextSm className="!text-xs">{s.covers}</TextSm>
                  </TableCell>
                  <TableCell className="align-top">
                    <TextSm className={cn('!text-xs', s.auth === '—' && '!text-ink-faint')}>{s.auth}</TextSm>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
