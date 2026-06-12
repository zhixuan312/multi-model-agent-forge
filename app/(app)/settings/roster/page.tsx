import { Layers, Boxes, Cpu, Database } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { listRoster } from '@/config/roster-core';
import { listProviders } from '@/config/providers-core';
import { readModelProfiles } from '@/mma/model-profiles';
import { PageFrame, MetricCard } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { RosterPanel, type RosterRowData, type ProviderOption } from './RosterPanel';
// Provider→model map: the real backend has no per-provider model endpoint yet,
// so this read is served by the mock provider domain for now.
import { getModelsByProvider } from '@/mock/domains/settings/providers';

/**
 * Team Settings → Roster (Spec 2 §Agent roster / agent-roster.html). Admin-gated.
 * Same surface as Members: a STATUS row of four metric boxes, then a 2/3 ∣ 1/3
 * row — one card per tier (main / complex / standard), each a provider + a model
 * scoped to that provider (Primary), and the guidance note (Rail).
 */
export default async function RosterPage() {
  await requireAdminPage();
  const catalog = readModelProfiles();
  const [roster, providers, modelsByProvider] = await Promise.all([
    listRoster(),
    listProviders(),
    getModelsByProvider(),
  ]);

  const rows: RosterRowData[] = roster.map((r) => ({ tier: r.tier, providerId: r.providerId, model: r.model }));
  const options: ProviderOption[] = providers.map((p) => ({ id: p.id, name: p.name }));
  const modelCount = new Set(Object.values(modelsByProvider).flat()).size;

  const configured = rows.filter((r) => r.providerId && r.model).length;

  return (
    <PageFrame title="Team settings" subnav={<SettingsTabs active="roster" />} width="full">
      <div className="flex flex-col gap-4">
        {/* STATUS — four equal metric boxes */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Tiers configured" value={`${configured}/3`} muted={configured === 0} sublabel="Provider + model set" icon={<Layers />} iconTint="accent" />
          <MetricCard label="Providers" value={options.length} muted={options.length === 0} sublabel="Available to assign" icon={<Boxes />} iconTint="steel" />
          <MetricCard label="Models" value={modelCount} muted={modelCount === 0} sublabel="Across all providers" icon={<Cpu />} iconTint="sage" />
          <MetricCard label="MMA catalog" value={catalog.available ? 'Live' : 'Offline'} muted={!catalog.available} sublabel="Model profiles" icon={<Database />} iconTint="rose" />
        </div>

        <RosterPanel initialRoster={rows} providers={options} modelsByProvider={modelsByProvider} />
      </div>
    </PageFrame>
  );
}
