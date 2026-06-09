import { requireAdminPage } from '@/auth/require-admin';
import { getConnections } from '@/config/connections-core';
import { PageHeader } from '@/components/forge/PageHeader';
import { SettingsTabs } from '@/components/forge/SettingsTabs';
import { ConnectionsForm } from './ConnectionsForm';

/**
 * Team Settings → Connections (Spec 2 §Connections / connections.html).
 * Admin-gated. MMA (base URL + bearer token) and Git (service token), plus the
 * OpenAI transcription key — each token stored via the SecretStore, shown only
 * as "set / not set". (Test connection / Save & apply to MMA is Part B.)
 */
export default async function ConnectionsPage() {
  await requireAdminPage();
  const view = await getConnections();

  return (
    <>
      <PageHeader title="Team settings" />
      <SettingsTabs active="connections" />

      <div className="mb-1">
        <h2 className="font-serif text-xl font-semibold text-ink">Connections</h2>
        <p className="mt-1 max-w-[600px] text-sm text-ink-soft">
          The MMA endpoint Forge calls every rod through, and the git service token that clones &amp;
          pulls team repos. Secrets are stored encrypted and never shown.
        </p>
      </div>

      <ConnectionsForm
        initial={{
          mmaBaseUrl: view.mmaBaseUrl,
          mmaTokenSet: view.mmaTokenSet,
          gitTokenSet: view.gitTokenSet,
          openaiTranscriptionKeySet: view.openaiTranscriptionKeySet,
        }}
      />
    </>
  );
}
