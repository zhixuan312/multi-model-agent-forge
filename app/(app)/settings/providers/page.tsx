import { requireAdminPage } from '@/auth/require-admin';
import { listProviders } from '@/config/providers-core';
import { PageFrame, SectionTitle, Mono } from '@/components/ui';
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
    <PageFrame title="Team settings" subnav={<SettingsTabs active="providers" />}>
      <div className="flex flex-col gap-6">
        <SectionTitle
          description={
            <>
              Configure once. <Mono>type</Mono> = <Mono>claude</Mono> (Anthropic-style) or{' '}
              <Mono>codex</Mono> (OpenAI-style). Leave base URL / key blank to use the provider default.
            </>
          }
        >
          Providers
        </SectionTitle>

        <ProvidersPanel initial={rows} />
      </div>
    </PageFrame>
  );
}
