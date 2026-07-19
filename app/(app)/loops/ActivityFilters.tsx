'use client';

import { useRouter } from 'next/navigation';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Label } from '@/components/ui';
import { statusLabel } from './run-format';

const ALL = '__all';
const STATUSES = ['running', 'changed', 'no_changes', 'failed'];

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
