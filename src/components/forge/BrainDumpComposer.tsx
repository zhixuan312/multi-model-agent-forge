'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Paperclip, X, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Textarea, TextSm } from '@/components/ui';
import type { AttachmentView } from '@/exploration/attachments';

/** Choose the MediaRecorder mimeType: webm/opus when supported, else mp4 (Safari). */
export function pickRecorderMime(
  isTypeSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): string {
  if (isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  return 'audio/mp4';
}

function RecordingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <div className="flex items-center gap-2 rounded-[var(--r)] bg-rose/10 px-3 py-1.5 text-xs font-medium text-[var(--rose)]">
      <span className="size-2 animate-pulse rounded-full bg-[var(--rose)]" />
      Recording {m}:{String(s).padStart(2, '0')}
    </div>
  );
}

function TranscribingIndicator() {
  return (
    <div className="flex items-center gap-2 rounded-[var(--r)] bg-accent-tint px-3 py-1.5 text-xs font-medium text-accent-deep">
      <Loader2 className="size-3.5 animate-spin" />
      Transcribing…
    </div>
  );
}

interface BrainDumpComposerProps {
  value: string;
  onChange: (v: string) => void;
  attachments: AttachmentView[];
  voiceEnabled: boolean;
  recording: boolean;
  transcribing: boolean;
  busy: boolean;
  error: string | null;
  onAnalyze: () => void;
  onToggleRecord: () => void;
  onAddFile: (file: File) => void;
  onRemoveAttachment: (id: string) => void;
}

export function BrainDumpComposer(props: BrainDumpComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll textarea to bottom when transcription appends text
  const prevLength = useRef(props.value.length);
  useEffect(() => {
    if (props.value.length > prevLength.current && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
    prevLength.current = props.value.length;
  }, [props.value]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3" aria-label="Brain dump">
      <div className="relative min-h-0 flex-1">
        <Textarea
          ref={textareaRef}
          aria-label="Tell Forge everything you know"
          placeholder="Tell Forge everything you know…"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          rows={5}
          className={cn(
            'min-h-[8rem] h-full resize-none',
            props.recording && 'border-[var(--rose)] ring-1 ring-[var(--rose)]/30',
          )}
        />
      </div>

      {/* Status bar — recording or transcribing */}
      {(props.recording || props.transcribing) ? (
        <div className="flex items-center gap-2">
          {props.recording ? <RecordingIndicator /> : <TranscribingIndicator />}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" data-testid="cbar">
        {props.voiceEnabled ? (
          <Button
            size="sm"
            variant={props.recording ? 'danger' : 'secondary'}
            aria-label={props.recording ? 'Stop recording' : 'Record voice'}
            aria-pressed={props.recording}
            onClick={props.onToggleRecord}
            disabled={props.transcribing}
            leftIcon={props.recording ? <MicOff /> : <Mic />}
          >
            {props.recording ? 'Stop' : 'Voice'}
          </Button>
        ) : null}

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

        <Button size="sm" loading={props.busy} disabled={props.recording || props.transcribing} onClick={props.onAnalyze} rightIcon={props.busy ? undefined : <ArrowRight />}>
          {props.busy ? 'Thinking…' : 'Analyze sources'}
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
