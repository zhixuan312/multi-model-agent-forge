import { requireAdminPage } from '@/auth/require-admin';
import { listRoster } from '@/config/roster-core';
import { listProviders } from '@/config/providers-core';
import { readModelProfiles } from '@/mma/model-profiles';
import { PageHeader, SectionTitle } from '@/components/ui';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { RosterPanel, type RosterRowData, type ProviderOption } from './RosterPanel';
import type { ModelSuggestion } from './ModelCombobox';

/**
 * Team Settings → Agent roster (Spec 2 §Agent roster / agent-roster.html).
 * Admin-gated. Three tiers (main / complex / standard), each → provider + model.
 * The model field is a combobox: profiled prefixes from MMA's co-located catalog
 * are suggestions, and a custom id is always allowed (Part B). Save updates the
 * agent_tier rows. (Save & apply to MMA lands with the config-supervisor.)
 */
export default async function RosterPage() {
  await requireAdminPage();
  const [roster, providers] = await Promise.all([listRoster(), listProviders()]);
  const catalog = readModelProfiles();
  const rows: RosterRowData[] = roster.map((r) => ({
    tier: r.tier,
    providerId: r.providerId,
    model: r.model,
  }));
  const options: ProviderOption[] = providers.map((p) => ({ id: p.id, name: p.name }));
  const modelSuggestions: ModelSuggestion[] = catalog.profiles.map((p) => ({
    provider: p.provider,
    prefix: p.prefix,
    bestFor: p.bestFor,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Team settings" />
      <SettingsTabs active="roster" />

      <SectionTitle
        description={
          <>
            Each tier picks a provider, then a model. <strong className="text-ink">Main</strong> is
            Forge&apos;s orchestrator; <strong className="text-ink">complex</strong> and{' '}
            <strong className="text-ink">standard</strong> are MMA&apos;s worker tiers.
          </>
        }
      >
        Three agent tiers
      </SectionTitle>

      <RosterPanel
        initialRoster={rows}
        providers={options}
        modelSuggestions={modelSuggestions}
        catalogAvailable={catalog.available}
      />
    </div>
  );
}
