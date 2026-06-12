import { Boxes, Bot, SquareTerminal, KeyRound } from 'lucide-react';
import { requireAdminPage } from '@/auth/require-admin';
import { listProviders } from '@/config/providers-core';
import { PageFrame, MetricCard } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { ProvidersPanel, type ProviderViewData } from './ProvidersPanel';

/**
 * Team Settings → Providers (Spec 2 §Providers / providers.html). Admin-gated.
 * Same surface as Members: a STATUS row of four metric boxes, then a 2/3 ∣ 1/3
 * row — the providers table (Primary) and the add/edit form + guidance (Rail).
 * The api key is write-only — the list never carries it.
 */
export default async function ProvidersPage() {
  await requireAdminPage();
  const providers = await listProviders();
  const rows: ProviderViewData[] = providers.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    baseUrl: p.baseUrl,
    apiKeySet: p.apiKeySet,
  }));

  const total = rows.length;
  const claude = rows.filter((p) => p.type === 'claude').length;
  const codex = rows.filter((p) => p.type === 'codex').length;
  const keysSet = rows.filter((p) => p.apiKeySet).length;

  return (
    <PageFrame title="Team settings" subnav={<SettingsTabs active="providers" />} width="full">
      <div className="flex flex-col gap-4">
        {/* STATUS — four equal metric boxes */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Providers" value={total} muted={total === 0} sublabel="Configured" icon={<Boxes />} iconTint="accent" />
          <MetricCard label="Anthropic-style" value={claude} muted={claude === 0} sublabel="type · claude" icon={<Bot />} iconTint="sage" />
          <MetricCard label="OpenAI-style" value={codex} muted={codex === 0} sublabel="type · codex" icon={<SquareTerminal />} iconTint="steel" />
          <MetricCard label="API keys" value={keysSet} muted={keysSet === 0} sublabel="Set on a provider" icon={<KeyRound />} iconTint="rose" />
        </div>

        <ProvidersPanel initial={rows} />
      </div>
    </PageFrame>
  );
}
