import { Layers, Bot, SquareTerminal, KeyRound, Cpu } from 'lucide-react';
import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { readMmaTiers } from '@/mma/mma-config-reader';
import { readModelProfiles } from '@/mma/model-profiles';
import { PageFrame } from '@/components/ui';
import { OrgSettingsTabs } from '@/components/forge/OrgSettingsTabs';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import { ModelsPanel } from './ModelsPanel';

const MODELS_NOTE = `### Agent tiers

- **Main** — orchestrates: plans the work, routes tasks
- **Complex** — the expert: reviews, audits, checks security
- **Standard** — the workhorse: writes, edits, runs tests

### How it signs in

- **Subscription** — a plan you already pay for (Claude or ChatGPT); nothing to paste
- **API key** — paste a provider key; add a Base URL only for custom / self-hosted

### Configure

- **Validate** — checks the model actually works
- **Apply** — switches the agent to it`;

/**
 * Org Settings → Models (the merged Providers + Roster surface). Provider/model
 * configuration is org-owned (FR-9), org_admin only. Same shell as the other
 * tabs: a STATUS row of four metric boxes, then a 2/3 ∣ 1/3 row — the tier panel
 * (Primary) and the access note (Rail). Each tier is configured +
 * validated/applied against the live mma via `POST /configure-provider`.
 */
export default async function ModelsPage() {
  const me = await currentMember();
  if (!me) redirect('/login');
  if (me.role !== 'org_admin') redirect('/');
  const tiers = readMmaTiers();
  const suggestions = readModelProfiles().profiles;

  const values = Object.values(tiers);
  const configured = values.filter(Boolean).length;
  const claude = values.filter((t) => t?.dialect === 'claude').length;
  const codex = values.filter((t) => t?.dialect === 'codex').length;
  const apiKeys = values.filter((t) => t?.authMode === 'api-key').length;

  return (
    <PageFrame title="Org settings" subnav={<OrgSettingsTabs active="models" />} width="full" fill>
      <StageShell
      scroll="outer"
        align="start"
        metrics={[
          { label: 'Tiers configured', value: configured, muted: configured === 0, sublabel: 'of 3 tiers', icon: <Layers />, iconTint: 'accent' },
          { label: 'Anthropic-style', value: claude, muted: claude === 0, sublabel: 'tiers · claude', icon: <Bot />, iconTint: 'sage' },
          { label: 'OpenAI-style', value: codex, muted: codex === 0, sublabel: 'tiers · codex', icon: <SquareTerminal />, iconTint: 'steel' },
          { label: 'API keys', value: apiKeys, muted: apiKeys === 0, sublabel: 'rest use OAuth', icon: <KeyRound />, iconTint: 'rose' },
        ]}
        note={<RailNote icon={<Cpu />}>{MODELS_NOTE}</RailNote>}
      >
<ModelsPanel tiers={tiers} suggestions={suggestions} />
      </StageShell>
    </PageFrame>
  );
}
