'use client';

import { useRouter } from 'next/navigation';
import { ArchiveRestore, ArchiveX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';

interface ProjectArchiveButtonProps {
  projectId: string;
  archived: boolean;
}

export function ProjectArchiveButton({ projectId, archived }: ProjectArchiveButtonProps) {
  const router = useRouter();
  const optimistic = useOptimisticAction();

  const label = archived ? 'Unarchive project' : 'Archive project';

  async function commit(): Promise<void> {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: !archived }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Could not update archive state.' }));
      throw new Error(body.error ?? 'Could not update archive state.');
    }
  }

  return (
    <Button
      type="button"
      variant={archived ? 'secondary' : 'ghost'}
      size="sm"
      aria-label={label}
      disabled={optimistic.pending}
      leftIcon={archived ? <ArchiveRestore /> : <ArchiveX />}
      onClick={() => {
        void optimistic.run({
          apply: () => {},
          commit,
          rollback: () => {},
          error: archived ? 'Could not unarchive project.' : 'Could not archive project.',
          retryable: true,
          onSettled: () => router.refresh(),
        });
      }}
    >
      {archived ? 'Unarchive' : 'Archive'}
    </Button>
  );
}
