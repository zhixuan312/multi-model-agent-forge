import { Lock, Plug, Mic, GitCompare } from 'lucide-react';
import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { getConnections } from '@/config/connections-core';
import { readMmaBearer } from '@/mma/client-config';
import { buildMmaClient } from '@/mma/server-client';
import { compareMmaVersion, MATCHED_MMA_VERSION, type MmaVersionStatus } from '@/mma/matched-version';
import { PageFrame } from '@/components/ui';
import type { MetricCardProps } from '@/components/ui/metric-card';
import { OrgSettingsTabs } from '@/components/forge/OrgSettingsTabs';
import { ConnectionsForm } from './ConnectionsForm';

/**
 * Live-engine version vs the version THIS Forge build is matched with. Reads the
 * engine's /status (graceful — unreachable → null → 'unknown'). The badge answers
 * "which MMA are we matched with, and has the engine moved past it?".
 */
async function resolveMmaVersion(): Promise<MmaVersionStatus> {
  try {
    const client = await buildMmaClient();
    const status = await client.status();
    return compareMmaVersion(status.version);
  } catch {
    return compareMmaVersion(null);
  }
}

/** The version-match metric: value = the matched version; sublabel = live-engine drift. */
function versionMetric(v: MmaVersionStatus): MetricCardProps {
  const sublabel =
    v.status === 'matched'
      ? `Engine v${v.live} · matched`
      : v.status === 'engine-ahead'
        ? `Engine v${v.live} · update Forge`
        : v.status === 'engine-behind'
          ? `Engine v${v.live} · older than matched`
          : 'Engine unreachable';
  const iconTint = v.status === 'matched' ? 'sage' : v.status === 'engine-ahead' ? 'rose' : 'steel';
  return {
    label: 'MMA version',
    value: `v${MATCHED_MMA_VERSION}`,
    sublabel,
    muted: v.status === 'unknown',
    icon: <GitCompare />,
    iconTint,
  };
}

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
  const mmaVersion = await resolveMmaVersion();

  const setCount = (mmaBearer ? 1 : 0) + (view.openaiTranscriptionKeySet ? 1 : 0);

  return (
    <PageFrame title="Org settings" subnav={<OrgSettingsTabs active="connections" />} width="full" fill>
      {/* ConnectionsForm composes the canonical StatusDashboard (metrics + cards + guidance rail). */}
      <ConnectionsForm
        mmaBearer={mmaBearer}
        initial={{
          mmaBaseUrl: view.mmaBaseUrl,
          openaiTranscriptionKeySet: view.openaiTranscriptionKeySet,
        }}
        metrics={[
          { label: 'Secrets set', value: `${setCount}/2`, muted: setCount === 0, sublabel: 'Stored encrypted', icon: <Lock />, iconTint: 'accent' },
          { label: 'MMA', value: mmaBearer ? 'Ready' : 'No token', muted: !mmaBearer, sublabel: 'Auto token', icon: <Plug />, iconTint: 'steel' },
          versionMetric(mmaVersion),
          { label: 'Voice', value: view.openaiTranscriptionKeySet ? 'On' : 'Off', muted: !view.openaiTranscriptionKeySet, sublabel: 'Speech to text', icon: <Mic />, iconTint: 'rose' },
        ]}
      />
    </PageFrame>
  );
}
