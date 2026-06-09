import { requireAdminPage } from '@/auth/require-admin';
import { listProviders } from '@/config/providers-core';
import { PageHeader } from '@/components/forge/PageHeader';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { ProvidersPanel, type ProviderViewData } from './ProvidersPanel';

/**
 * Team Settings → Providers (Spec 2 §Providers / providers.html). Admin-gated.
 * Lists configured providers (name, type, base URL, key set/not), with add /
 * edit / delete. The api key is write-only — the list never carries it.
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

  return (
    <>
      <PageHeader title="Team settings" />
      <SettingsTabs active="providers" />

      <div className="mb-1">
        <h2 className="font-serif text-xl font-semibold text-ink">Providers</h2>
        <p className="mt-1 max-w-[600px] text-sm text-ink-soft">
          Configure once. <span className="font-mono text-xs">type</span> ={' '}
          <span className="font-mono text-xs">claude</span> (Anthropic-style) or{' '}
          <span className="font-mono text-xs">codex</span> (OpenAI-style). Leave base URL / key
          blank to use the provider default.
        </p>
      </div>

      <ProvidersPanel initial={rows} />
    </>
  );
}
