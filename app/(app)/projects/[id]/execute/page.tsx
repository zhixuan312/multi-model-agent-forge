import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { USE_MOCK } from '@/mock/config';
import { mockExecute } from '@/mock/domains/projects/execute';
import { ExecuteStageClient } from '@/components/forge/ExecuteStageClient';

/**
 * Execute stage (BUILD group) — the locked plan is handed to MMA execute-plan,
 * which runs each task one-by-one: Dispatch → Run → Land. Automated mode can drive
 * the whole run; the human can step in and watch at any point.
 */
export default async function ExecuteStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect('/login');

  if (USE_MOCK) {
    const m = mockExecute(id);
    return (
      <ExecuteStageClient
        projectId={id}
        projectName={m.projectName}
        planVersion={m.planVersion}
        phase="build"
        mmaReady={m.mmaReady}
        units={m.units}
        writeTargets={m.writeTargets}
      />
    );
  }

  // Real backend wiring lands later; the legacy build monitor lives at /build.
  redirect(`/projects/${id}/build`);
}
