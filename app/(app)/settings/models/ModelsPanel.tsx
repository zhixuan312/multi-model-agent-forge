'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, Field, Input, Button, Badge, Micro, Label, TextStrong, Mono } from '@/components/ui';
import { VerifyResultBox } from '@/components/forge/VerifyResultBox';
import type { MmaTiers, TierKey, TierConfig } from '@/mma/mma-config-reader';
import type { FlatProfile } from '@/mma/model-profiles';

type Dialect = 'claude' | 'codex';
type AuthMode = 'oauth' | 'api-key';

interface ConfigureResponse {
  verified: boolean;
  reason: string;
  applied: boolean;
  tier: string;
  provider: string;
  model: { id: string; family: string; tier: string; recognized: boolean };
  probe?: { reachable: boolean; modelListed: boolean | null; detail: string };
}

const TIER_META: { key: TierKey; title: string }[] = [
  { key: 'main', title: 'Main' },
  { key: 'complex', title: 'Complex' },
  { key: 'standard', title: 'Standard' },
];

/**
 * The Primary (2/3) panel of the Models tab — one bordered "spotlight" panel
 * (same shell as the Members/Providers tables) with the three agent tiers as
 * rows. Each row shows its current config and expands an inline Configure flow.
 */
export function ModelsPanel({ tiers, suggestions }: { tiers: MmaTiers; suggestions: FlatProfile[] }) {
  const [open, setOpen] = useState<TierKey | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {TIER_META.map((m) => (
        <TierCard
          key={m.key}
          meta={m}
          current={tiers[m.key]}
          suggestions={suggestions}
          open={open === m.key}
          onOpen={() => setOpen(m.key)}
          onClose={() => setOpen(null)}
        />
      ))}
    </div>
  );
}

/** One tier in its own card box — mirrors the Connections groups. */
function TierCard({
  meta,
  current,
  suggestions,
  open,
  onOpen,
  onClose,
}: {
  meta: { key: TierKey; title: string };
  current: TierConfig | null;
  suggestions: FlatProfile[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <TextStrong className="block !text-sm !text-ink">{meta.title}</TextStrong>
            {current ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant={current.dialect === 'claude' ? 'sage' : 'steel'} size="sm">
                  {current.dialect}
                </Badge>
                <Mono className="!text-xs text-ink">{current.model}</Mono>
                <Micro>· {current.authMode === 'oauth' ? 'Subscription' : 'API key'}</Micro>
                {current.baseUrl ? <Micro className="truncate">· {current.baseUrl}</Micro> : null}
              </div>
            ) : (
              <Micro className="mt-1.5 block">— not configured</Micro>
            )}
          </div>
          {!open ? (
            <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={onOpen}>
              Edit
            </Button>
          ) : null}
        </div>
        {open ? (
          <div className="border-t border-line pt-4">
            <ConfigureForm tier={meta.key} current={current} suggestions={suggestions} onCancel={onClose} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConfigureForm({
  tier,
  current,
  suggestions,
  onCancel,
}: {
  tier: TierKey;
  current: TierConfig | null;
  suggestions: FlatProfile[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const [dialect, setDialect] = useState<Dialect>((current?.dialect as Dialect) ?? 'claude');
  const [model, setModel] = useState(current?.model ?? '');
  const [authMode, setAuthMode] = useState<AuthMode>(current?.authMode ?? 'oauth');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '');
  const [result, setResult] = useState<ConfigureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'validate' | 'apply'>(null);

  const modelHints = suggestions
    .filter((s) => (dialect === 'claude' ? /anthropic|claude/i.test(s.provider) : /openai|codex/i.test(s.provider)))
    .map((s) => s.prefix);

  async function run(dryRun: boolean) {
    setError(null);
    setBusy(dryRun ? 'validate' : 'apply');
    const auth =
      authMode === 'oauth'
        ? { mode: 'oauth' as const }
        : { mode: 'api-key' as const, apiKey, ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) };
    try {
      const res = await fetch('/api/configure-provider', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, provider: dialect, model: model.trim(), auth, dryRun }),
      });
      const body = (await res.json().catch(() => null)) as (ConfigureResponse & { message?: string }) | null;
      if (!res.ok || !body) {
        setError(body?.message ?? 'Request failed.');
        setResult(null);
        return;
      }
      setResult(body);
      if (!dryRun && body.applied) router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label as="span">Dialect</Label>
        <Segmented
          value={dialect}
          onChange={(v) => {
            setDialect(v as Dialect);
            setResult(null);
          }}
          options={[
            { value: 'claude', label: 'claude' },
            { value: 'codex', label: 'codex' },
          ]}
        />
      </div>

      <Field label="Model" hint="catalog suggestions · custom ids allowed">
        {(p) => (
          <>
            <Input
              {...p}
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setResult(null);
              }}
              placeholder={dialect === 'claude' ? 'e.g. claude-opus-4-8' : 'e.g. gpt-5.5'}
              className="font-mono"
              list={listId}
            />
            <datalist id={listId}>
              {modelHints.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </>
        )}
      </Field>

      <div className="flex flex-col gap-1.5">
        <Label as="span">Sign-in</Label>
        <Segmented
          value={authMode}
          onChange={(v) => {
            setAuthMode(v as AuthMode);
            setResult(null);
          }}
          options={[
            { value: 'oauth', label: 'Subscription' },
            { value: 'api-key', label: 'API key' },
          ]}
        />
      </div>
      {authMode === 'api-key' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="API key">
            {(p) => (
              <Input
                {...p}
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setResult(null);
                }}
                placeholder="paste your provider key"
                className="font-mono"
              />
            )}
          </Field>
          <Field label="Base URL" hint="only for custom / self-hosted">
            {(p) => (
              <Input
                {...p}
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setResult(null);
                }}
                placeholder="leave blank for the default"
                className="font-mono"
              />
            )}
          </Field>
        </div>
      ) : (
        <Micro>
          Uses the {dialect === 'claude' ? 'Claude' : 'ChatGPT / OpenAI'} subscription you already pay for — nothing to paste.
        </Micro>
      )}

      {error ? (
        <Micro role="alert" className="block text-rose">
          {error}
        </Micro>
      ) : null}

      {result ? <ResultLadder result={result} /> : null}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
        <Micro className={cn(result?.verified ? 'text-[var(--sage-deep)]' : 'text-ink-faint')}>
          {result?.verified ? 'Validated — ready to apply.' : 'Validate first to enable Apply.'}
        </Micro>
        <div className="flex items-center gap-2.5">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => run(true)}
            loading={busy === 'validate'}
            disabled={!model.trim() || (authMode === 'api-key' && !apiKey)}
          >
            {busy === 'validate' ? 'Validating…' : 'Validate'}
          </Button>
          <Button type="button" onClick={() => run(false)} loading={busy === 'apply'} disabled={!result?.verified}>
            {busy === 'apply' ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultLadder({ result }: { result: ConfigureResponse }) {
  const rows: { label: string; ok: boolean | null }[] = [
    { label: `recognized · ${result.model.family} · ${result.model.tier}`, ok: result.model.recognized },
    { label: 'reachable', ok: result.probe ? result.probe.reachable : null },
    { label: 'model listed', ok: result.probe ? result.probe.modelListed : null },
  ];
  return (
    <VerifyResultBox
      ok={result.verified}
      extra={
        result.applied ? (
          <Badge variant="accent" size="sm">
            applied
          </Badge>
        ) : null
      }
    >
      <Micro className="block !text-ink-soft">{result.reason}</Micro>
      <div className="mt-1 flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            {r.ok === null ? (
              <span className="size-3.5 rounded-full border border-line" aria-hidden />
            ) : r.ok ? (
              <Check className="size-3.5 text-[var(--sage-deep)]" aria-hidden />
            ) : (
              <X className="size-3.5 text-rose" aria-hidden />
            )}
            <Micro className={cn(r.ok === null && 'text-ink-faint')}>{r.label}</Micro>
          </div>
        ))}
      </div>
    </VerifyResultBox>
  );
}

/** A small segmented control (radiogroup) for the dialect / auth toggles. */
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div role="radiogroup" className="inline-flex w-fit rounded-[var(--r-md)] border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'focus-ring rounded-[calc(var(--r-md)-2px)] px-3 py-1 text-sm transition-colors',
            value === o.value ? 'bg-accent-tint font-medium text-accent-deep' : 'text-ink-soft hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
