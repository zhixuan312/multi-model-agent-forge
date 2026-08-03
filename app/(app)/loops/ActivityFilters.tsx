'use client';

import { useRouter } from 'next/navigation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Label } from '@/components/ui';
import { LOOP_RUN_STATUS } from '@/db/enums';
import { statusLabel } from './run-format';

const ALL = '__all';
/**
 * From the enum, not a copy of it. This was a hand-written
 * `['running', 'changed', 'no_changes', 'failed']` — add a fifth run status and the filter
 * would silently omit it, leaving those runs unfilterable with no error anywhere.
 */
const STATUSES = LOOP_RUN_STATUS;

/** Loop + status filters for the Activity log. State lives in the URL (shareable, RSC-friendly). */
export function ActivityFilters({
  loops,
  loopId,
  status,
}: {
  loops: { id: string; name: string }[];
  loopId?: string;
  status?: string;
}) {
  const router = useRouter();

  function go(loop: string, st: string) {
    const params = new URLSearchParams();
    if (loop && loop !== ALL) params.set('loop', loop);
    if (st && st !== ALL) params.set('status', st);
    const qs = params.toString();
    router.push(qs ? `/loops/activity?${qs}` : '/loops/activity');
  }

  return (
    <div className="flex items-end gap-3">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label as="span">Loop</Label>
        <Select value={loopId ?? ALL} onValueChange={(v) => go(v, status ?? ALL)}>
          <SelectTrigger className="w-full" aria-label="Filter by loop"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All loops</SelectItem>
            {loops.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label as="span">Status</Label>
        <Select value={status ?? ALL} onValueChange={(v) => go(loopId ?? ALL, v)}>
          <SelectTrigger className="w-full" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
