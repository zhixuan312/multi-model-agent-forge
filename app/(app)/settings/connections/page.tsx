import { Lock, Plug, GitBranch, Mic } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { getConnections } from '@/config/connections-core';
import { readDevTokenFallback } from '@/mma/client-config';
import { PageFrame, MetricCard } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { ConnectionsForm } from './ConnectionsForm';

/**
 * Team Settings → Connections (Spec 2 §Connections / connections.html).
 * Admin-gated. Same surface as Members: a STATUS row of four metric boxes, then
 * a 2/3 ∣ 1/3 row — the MMA / Git / OpenAI connection groups (Primary) and the
 * security guidance (Rail). Each token is stored encrypted via the SecretStore
 * and shown only as "set / not set".
 */
export default async function ConnectionsPage() {
  await requireAdminPage();
  const view = await getConnections();
  // The MMA bearer is auto-managed by the local mmagent (read-only here).
  const mmaBearer = readDevTokenFallback();

  const setCount =
    (mmaBearer ? 1 : 0) + (view.gitTokenSet ? 1 : 0) + (view.openaiTranscriptionKeySet ? 1 : 0);

  return (
    <PageFrame title="Team settings" subnav={<SettingsTabs active="connections" />} width="full">
      <div className="flex flex-col gap-4">
        {/* STATUS — four equal metric boxes */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Secrets set" value={`${setCount}/3`} muted={setCount === 0} sublabel="Stored encrypted" icon={<Lock />} iconTint="accent" />
          <MetricCard label="MMA" value={mmaBearer ? 'Ready' : 'No token'} muted={!mmaBearer} sublabel="Auto token" icon={<Plug />} iconTint="steel" />
          <MetricCard label="Git access" value={view.gitTokenSet ? 'Ready' : 'No token'} muted={!view.gitTokenSet} sublabel="Clone & pull" icon={<GitBranch />} iconTint="sage" />
          <MetricCard label="Voice" value={view.openaiTranscriptionKeySet ? 'On' : 'Off'} muted={!view.openaiTranscriptionKeySet} sublabel="Speech to text" icon={<Mic />} iconTint="rose" />
        </div>

        <ConnectionsForm
          mmaBearer={mmaBearer}
          initial={{
            mmaBaseUrl: view.mmaBaseUrl,
            mmaTokenSet: view.mmaTokenSet,
            gitTokenSet: view.gitTokenSet,
            openaiTranscriptionKeySet: view.openaiTranscriptionKeySet,
          }}
        />
      </div>
    </PageFrame>
  );
}
