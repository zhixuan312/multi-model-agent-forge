'use client';

import { useRef } from 'react';
import { Mic, Link2, Paperclip, X, ArrowRight } from 'lucide-react';
import { Button, Textarea, TextSm } from '@/components/ui';
import type { AttachmentView } from '@/exploration/attachments';

/**
 * `BrainDumpComposer` (Spec 5 flow A) — the "Tell Forge everything you know"
 * textarea + a control bar with voice (record→transcribe→APPEND, never replace),
 * attach link/file, and the Analyze-sources CTA. Attachment chips render below.
 * Voice/attach controls are keyboard-operable with aria-labels; the record
 * toggle exposes `aria-pressed` (F19).
 */

/** Choose the MediaRecorder mimeType: webm/opus when supported, else mp4 (Safari). */
export function pickRecorderMime(
  isTypeSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): string {
  if (isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  return 'audio/mp4';
}

interface BrainDumpComposerProps {
  value: string;
  onChange: (v: string) => void;
  attachments: AttachmentView[];
  voiceEnabled: boolean;
  recording: boolean;
  busy: boolean;
  error: string | null;
  onAnalyze: () => void;
  onToggleRecord: () => void;
  onAddLink: () => void;
  onAddFile: (file: File) => void;
  onRemoveAttachment: (id: string) => void;
}

export function BrainDumpComposer(props: BrainDumpComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section className="flex flex-col gap-3" aria-label="Brain dump">
      <Textarea
        aria-label="Tell Forge everything you know"
        placeholder="Tell Forge everything you know…"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={5}
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="cbar">
        {props.voiceEnabled ? (
          <Button
            size="sm"
            variant={props.recording ? 'danger' : 'secondary'}
            aria-label="Record voice"
            aria-pressed={props.recording}
            onClick={props.onToggleRecord}
            leftIcon={<Mic />}
          >
            {props.recording ? 'Stop' : 'Voice'}
          </Button>
        ) : null}

        <Button size="sm" variant="secondary" aria-label="Attach link" onClick={props.onAddLink} leftIcon={<Link2 />}>
          Link
        </Button>

        <Button
          size="sm"
          variant="secondary"
          aria-label="Attach file"
          onClick={() => fileInput.current?.click()}
          leftIcon={<Paperclip />}
        >
          File
        </Button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onAddFile(f);
            e.target.value = '';
          }}
        />

        <span className="flex-1" />

        <Button size="sm" disabled={props.busy} onClick={props.onAnalyze} rightIcon={<ArrowRight />}>
          Analyze sources
        </Button>
      </div>

      {props.error ? <TextSm className="!text-[var(--rose)]">{props.error}</TextSm> : null}

      {props.attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="attachments">
          {props.attachments.map((a) => (
            <span
              key={a.id}
              data-att-id={a.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink"
            >
              <span className="text-ink-soft">[{a.kind}]</span>
              {a.label}
              <button
                type="button"
                aria-label={`Remove ${a.label}`}
                onClick={() => props.onRemoveAttachment(a.id)}
                className="text-ink-soft transition-colors hover:text-[var(--rose)]"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
