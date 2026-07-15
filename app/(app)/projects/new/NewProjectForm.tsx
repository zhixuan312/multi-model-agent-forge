'use client';

import { Fragment, useEffect, useRef, useState, useActionState, type ReactNode } from 'react';
import { ArrowRight, ChevronRight, FileText, Globe, Lock, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Card,
  CardContent,
  CardFooter,
  Input,
  Button,
  Field,
  Label,
  Micro,
  Badge,
  Separator,
} from '@/components/ui';
import { showToast } from '@/components/ui/toast';
import { RepoPicker, type RepoPickerRepo } from '@/components/forge/RepoPicker';
import { createProjectAction, type NewProjectState } from './actions';

type DesignStage = 'exploration' | 'spec' | 'plan';
type UploadKind = 'exploration' | 'spec';

/**
 * The seven ways a project can be scoped. Six are the contiguous design-chain runs
 * (`VALID_SUBSET_RUNS` in create-project-subset.ts); the seventh is Full SDLC (an
 * empty `stages` array — the server treats `selectedDesignStages: []` as "run
 * everything"). Presenting these as mutually exclusive options makes the invalid
 * non-contiguous combos (e.g. exploration+plan) unrepresentable, so the old
 * contiguity error can never fire from the UI. `requires` names the upstream
 * artifact the user must upload for a run that starts past exploration.
 */
interface Preset {
  key: string;
  title: string;
  stages: DesignStage[];
  requires?: UploadKind;
  produces: string;
}

const PRESETS: Preset[] = [
  { key: 'full', title: 'Full SDLC', stages: [], produces: 'Every stage — from idea to merged code.' },
  { key: 'exploration', title: 'Exploration', stages: ['exploration'], produces: 'An exploration doc, then reflect.' },
  { key: 'exploration-spec', title: 'Exploration → Spec', stages: ['exploration', 'spec'], produces: 'Exploration and spec, then reflect.' },
  { key: 'design', title: 'Full design', stages: ['exploration', 'spec', 'plan'], produces: 'Exploration, spec, and plan, then reflect.' },
  { key: 'spec', title: 'Spec', stages: ['spec'], requires: 'exploration', produces: 'A spec built from your exploration, then reflect.' },
  { key: 'spec-plan', title: 'Spec → Plan', stages: ['spec', 'plan'], requires: 'exploration', produces: 'A spec and plan built from your exploration, then reflect.' },
  { key: 'plan', title: 'Plan', stages: ['plan'], requires: 'spec', produces: 'A plan built from your spec, then reflect.' },
];

/** The full six-stage pipeline, labelled to match the live project stage rail. */
const PIPELINE: { kind: DesignStage | 'execute' | 'review' | 'journal'; label: string }[] = [
  { kind: 'exploration', label: 'Explore' },
  { kind: 'spec', label: 'Spec' },
  { kind: 'plan', label: 'Plan' },
  { kind: 'execute', label: 'Execute' },
  { kind: 'review', label: 'Review' },
  { kind: 'journal', label: 'Reflect' },
];

type StepState = 'entry' | 'run' | 'skip';

/** Map a preset onto the six pipeline stages: where it starts, what runs, what skips. */
function stepStates(preset: Preset): StepState[] {
  const isFull = preset.stages.length === 0;
  const design: DesignStage[] = isFull ? ['exploration', 'spec', 'plan'] : preset.stages;
  const entry = design[0];
  return PIPELINE.map(({ kind }) => {
    if (kind === 'journal') return 'run'; // Reflect always runs — the universal terminal.
    if (kind === 'execute' || kind === 'review') return isFull ? 'run' : 'skip'; // Build only in Full SDLC.
    if (design.includes(kind as DesignStage)) return kind === entry ? 'entry' : 'run';
    return 'skip';
  });
}

/** Live preview of the resulting stage flow — mirrors the project page's stage rail. */
function StageFlowPreview({ preset }: { preset: Preset }) {
  const states = stepStates(preset);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2/50 p-3">
      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1.5">
        {PIPELINE.map((stage, i) => {
          const s = states[i];
          return (
            <Fragment key={stage.kind}>
              {i > 0 ? <ChevronRight aria-hidden className="size-3 shrink-0 text-ink-faint" /> : null}
              <span
                aria-label={`${stage.label}: ${s === 'skip' ? 'skipped' : s === 'entry' ? 'start' : 'runs'}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
                  s === 'skip' && 'text-ink-faint line-through decoration-ink-faint/50',
                  s === 'run' && 'text-ink',
                  s === 'entry' && 'bg-accent/10 font-semibold text-accent-deep ring-1 ring-inset ring-accent/30',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    s === 'skip' && 'bg-line-strong',
                    s === 'run' && 'bg-[var(--sage)]',
                    s === 'entry' && 'bg-accent',
                  )}
                />
                {stage.label}
              </span>
            </Fragment>
          );
        })}
      </div>
      <Micro>
        This project will produce: {preset.produces}
        {preset.stages.length > 0 ? ' Build (Execute · Review) is skipped.' : ''}
      </Micro>
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Base64-encode raw bytes in the browser (chunked so large files don't blow the arg limit). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Styled upload affordance for the upstream artifact a subset needs (an exploration
 * file for a spec-start run, a spec file for a plan-start run). Submission does NOT
 * rely on a native `<input type="file">` surviving into the server action's FormData
 * (that proved unreliable across browse/drop paths). Instead we read the chosen file's
 * bytes here and stash them base64-encoded in a hidden text field that is always part
 * of the form; the action decodes it and re-runs the size/UTF-8 (binary-rejection)
 * guards server-side. The file `<input>` is kept solely to open the OS picker.
 * Remounted (keyed on `requires`) when the required artifact KIND changes, so a stale
 * file never lingers across preset changes.
 */
function ArtifactUpload({
  requires,
  serverError,
  onFileChange,
}: {
  requires: UploadKind;
  serverError?: string;
  /** Reports whether a valid file is currently attached, so the form can gate submit. */
  onFileChange: (attached: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const noun = requires === 'exploration' ? 'exploration' : 'spec';
  const error = localError ?? serverError ?? null;

  // On (re)mount — which happens when the required artifact KIND changes — report an
  // empty slot so the parent re-gates. Switching between two runs that need the same
  // kind (spec ↔ spec+plan) does not remount, so a chosen file (and its "ready" state)
  // correctly persists across that switch.
  useEffect(() => {
    onFileChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isMarkdown(name: string) {
    return /\.(md|markdown|txt)$/i.test(name);
  }

  async function chooseFile(next: File | null) {
    if (!next) return;
    if (!isMarkdown(next.name)) {
      setLocalError('Upload a Markdown (.md) file.');
      return;
    }
    let encoded: string;
    try {
      encoded = bytesToBase64(new Uint8Array(await next.arrayBuffer()));
    } catch {
      setLocalError('Could not read that file — try again.');
      return;
    }
    setLocalError(null);
    setData(encoded);
    setFile(next);
    onFileChange(true);
  }

  function clearFile() {
    setFile(null);
    setData('');
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = '';
    onFileChange(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="artifact-upload">Your {noun} file</Label>
      {/* Actual submitted payload — always present in the form, independent of the picker. */}
      <input type="hidden" name="artifactData" value={data} />
      <input type="hidden" name="artifactName" value={file?.name ?? ''} />
      <input
        ref={inputRef}
        id="artifact-upload"
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="sr-only"
        aria-invalid={error ? true : undefined}
        onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2.5">
          <FileText aria-hidden className="size-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{file.name}</div>
            <Micro>{humanSize(file.size)} · we&apos;ll parse this into your project&apos;s {noun}</Micro>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md px-2 py-1 text-xs text-ink-soft hover:text-ink"
          >
            Replace
          </button>
          <button
            type="button"
            aria-label="Remove file"
            onClick={clearFile}
            className="rounded-md p-1 text-ink-soft hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void chooseFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            'flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
            dragOver ? 'border-accent bg-accent/5' : 'border-line-strong hover:border-accent/60 hover:bg-surface-2/50',
          )}
        >
          <UploadCloud aria-hidden className="size-6 text-ink-soft" />
          <span className="text-sm font-medium text-ink">
            Drop your {noun} file here, or <span className="text-accent">browse</span>
          </span>
          <Micro>Markdown (.md) in Forge&apos;s standard format — we&apos;ll ingest it as the project&apos;s real {noun}.</Micro>
        </button>
      )}

      {error ? (
        <Micro role="alert" className="text-rose">
          {error}
        </Micro>
      ) : null}
    </div>
  );
}

/** Eyebrow header that opens each field group, so the panel reads as sections not a stack. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-soft">
      {children}
    </span>
  );
}

export function NewProjectForm({ repos }: { repos: RepoPickerRepo[] }) {
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [visibility, setVisibility] = useState('public');
  const [presetKey, setPresetKey] = useState('full');
  const [uploadReady, setUploadReady] = useState(false);
  const [state, formAction, pending] = useActionState<NewProjectState, FormData>(createProjectAction, {});

  const nameError = state.error?.field === 'name' ? state.error.message : null;
  const repoError = state.error?.field === 'repoIds' ? state.error.message : null;
  const artifactError = state.error?.field === 'artifact' ? state.error.message : undefined;
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];

  // A subset that starts past Exploration cannot be created without its upstream file,
  // so block submit (and say why) until it is attached — rather than letting the click
  // hit the server only to bounce back as a rejection.
  const awaitingUpload = Boolean(preset.requires) && !uploadReady;

  // Surface every create failure as a toast (the action returns a fresh state object per
  // submit, so this fires once per rejection). Success paths redirect, so state.error is
  // the only terminal we observe here.
  useEffect(() => {
    if (state.error) showToast({ type: 'error', message: state.error.message });
  }, [state]);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      {selectedRepos.map((id) => <input key={id} type="hidden" name="repoIds" value={id} />)}
      {preset.stages.map((stage) => <input key={stage} type="hidden" name="selectedDesignStages" value={stage} />)}
      <input type="hidden" name="visibility" value={visibility} />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
          <section className="flex flex-col gap-4">
            <GroupLabel>Project</GroupLabel>

            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <Field label="Name" error={nameError ?? undefined} className="min-w-[240px] flex-1">
                {(p) => <Input {...p} name="name" placeholder="e.g. Unified Task API" autoFocus />}
              </Field>

              <Field label="Visibility" className="shrink-0">
                {() => (
                  <div className="flex gap-2">
                    {(['public', 'private'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-label={v}
                        onClick={() => setVisibility(v)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm',
                          visibility === v ? 'border-accent bg-accent/10' : 'border-line',
                        )}
                      >
                        {v === 'public' ? <Globe className="size-4" /> : <Lock className="size-4" />}
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <RepoPicker repos={repos} selected={selectedRepos} onChange={setSelectedRepos} />
            {repoError ? <Micro role="alert" className="text-rose">{repoError}</Micro> : null}
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <GroupLabel>Design run</GroupLabel>
              <Micro>Pick where this project starts and stops. Subsets skip Build and always end at Reflect.</Micro>
            </div>

            <div role="radiogroup" aria-label="Design run" className="grid gap-1.5">
              {PRESETS.map((p) => {
                const active = p.key === presetKey;
                return (
                  <label
                    key={p.key}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      active ? 'border-accent bg-accent/5' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name="__preset"
                      aria-label={p.title}
                      checked={active}
                      onChange={() => setPresetKey(p.key)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-full border',
                        active ? 'border-accent' : 'border-line-strong',
                      )}
                    >
                      {active ? <span className="size-2 rounded-full bg-accent" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{p.title}</span>
                      <span className="block text-xs text-ink-soft">{p.produces}</span>
                    </span>
                    {p.requires ? (
                      <Badge variant="amber" size="sm" icon={<UploadCloud />}>
                        needs {p.requires} file
                      </Badge>
                    ) : null}
                  </label>
                );
              })}
            </div>

            <StageFlowPreview preset={preset} />

            {preset.requires ? (
              <ArtifactUpload
                key={preset.requires}
                requires={preset.requires}
                serverError={artifactError}
                onFileChange={setUploadReady}
              />
            ) : null}
          </section>
        </CardContent>

        <CardFooter className="mt-auto flex items-center justify-between gap-3">
          <Micro className={cn(awaitingUpload ? 'text-ink-soft' : 'invisible')}>
            {preset.requires ? `Upload your ${preset.requires} file to continue` : ''}
          </Micro>
          <Button type="submit" loading={pending} disabled={awaitingUpload} rightIcon={<ArrowRight />}>
            {pending ? 'Creating…' : 'Create project'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
