import { Lock, Plug, Mic } from 'lucide-react';
import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { getConnections } from '@/config/connections-core';
import { readMmaBearer } from '@/mma/client-config';
import { PageFrame, MetricCard } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { ConnectionsForm } from './ConnectionsForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Org settings → MMA connection + voice (Spec 2 FR-9, org_admin only). Shared
 * infrastructure that every team runs through: the MMA engine base URL/bearer
 * and the org voice/transcription key. Git token is team-owned and lives under
 * Team settings. STATUS row of metric boxes, then the ConnectionsForm.
 */
export default async function ConnectionsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  if (me.role !== 'org_admin') redirect('/');

  const view = await getConnections();
  // The MMA bearer is auto-managed by the local mma (read-only here).
  const mmaBearer = readMmaBearer();

  const setCount = (mmaBearer ? 1 : 0) + (view.openaiTranscriptionKeySet ? 1 : 0);

  return (
    <PageFrame title="Org settings" subnav={<SettingsTabs active="org" />} width="full">
      <div className="flex flex-col gap-4">
        {/* STATUS — org infrastructure secrets */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MetricCard label="Secrets set" value={`${setCount}/2`} muted={setCount === 0} sublabel="Stored encrypted" icon={<Lock />} iconTint="accent" />
          <MetricCard label="MMA" value={mmaBearer ? 'Ready' : 'No token'} muted={!mmaBearer} sublabel="Auto token" icon={<Plug />} iconTint="steel" />
          <MetricCard label="Voice" value={view.openaiTranscriptionKeySet ? 'On' : 'Off'} muted={!view.openaiTranscriptionKeySet} sublabel="Speech to text" icon={<Mic />} iconTint="rose" />
        </div>

        {/* ConnectionsForm carries its own 2/3 ∣ 1/3 layout (cards + guidance rail). */}
        <ConnectionsForm
          mmaBearer={mmaBearer}
          initial={{
            mmaBaseUrl: view.mmaBaseUrl,
            openaiTranscriptionKeySet: view.openaiTranscriptionKeySet,
          }}
        />
      </div>
    </PageFrame>
  );
}
