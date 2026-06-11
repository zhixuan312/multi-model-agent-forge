import { requireAdminPage } from '@/auth/require-admin';
import { getConnections } from '@/config/connections-core';
import { PageFrame, SectionTitle } from '@/components/ui';
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
    <PageFrame title="Team settings" subnav={<SettingsTabs active="connections" />}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <SectionTitle description="The MMA endpoint Forge calls every rod through, and the git service token that clones & pulls team repos. Secrets are stored encrypted and never shown.">
          Connections
        </SectionTitle>

        <ConnectionsForm
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
