import { requireAdminPage } from '@/auth/require-admin';
import { listRoster } from '@/config/roster-core';
import { listProviders } from '@/config/providers-core';
import { PageHeader } from '@/components/forge/PageHeader';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { RosterPanel, type RosterRowData, type ProviderOption } from './RosterPanel';

/**
 * Team Settings → Agent roster (Spec 2 §Agent roster / agent-roster.html).
 * Admin-gated. Three tiers (main / complex / standard), each → provider + model
 * (model is free-text for now; Part B wires the profile dropdown). Save updates
 * the agent_tier rows. (Save & apply to MMA is Part B.)
 */
export default async function RosterPage() {
  await requireAdminPage();
  const [roster, providers] = await Promise.all([listRoster(), listProviders()]);
  const rows: RosterRowData[] = roster.map((r) => ({
    tier: r.tier,
    providerId: r.providerId,
    model: r.model,
  }));
  const options: ProviderOption[] = providers.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader title="Team settings" />
      <SettingsTabs active="roster" />

      <div className="mb-1">
        <h2 className="font-serif text-xl font-semibold text-ink">Three agent tiers</h2>
        <p className="mt-1 max-w-[600px] text-sm text-ink-soft">
          Each tier picks a provider, then a model. <strong>Main</strong> is Forge&apos;s
          orchestrator; <strong>complex</strong> and <strong>standard</strong> are MMA&apos;s worker
          tiers.
        </p>
      </div>

      <RosterPanel initialRoster={rows} providers={options} />
    </>
  );
}
