'use client';

import { useRef, useState } from 'react';
import { Mic, Link2, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/cn';
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
      <textarea
        aria-label="Tell Forge everything you know"
        placeholder="Tell Forge everything you know…"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={8}
        className="w-full resize-y rounded-[var(--r-md)] border border-line bg-surface-2 p-3 text-sm text-ink outline-none focus:border-accent"
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="cbar">
        {props.voiceEnabled ? (
          <button
            type="button"
            aria-label="Record voice"
            aria-pressed={props.recording}
            onClick={props.onToggleRecord}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line px-3 py-1.5 text-xs',
              props.recording ? 'bg-red-100 text-red-900' : 'bg-surface-2 text-ink',
            )}
          >
            <Mic className="h-3.5 w-3.5" /> {props.recording ? 'Stop' : 'Voice'}
          </button>
        ) : null}

        <button
          type="button"
          aria-label="Attach link"
          onClick={props.onAddLink}
          className="inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink"
        >
          <Link2 className="h-3.5 w-3.5" /> Link
        </button>

        <button
          type="button"
          aria-label="Attach file"
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink"
        >
          <Paperclip className="h-3.5 w-3.5" /> File
        </button>
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

        <button
          type="button"
          disabled={props.busy}
          onClick={props.onAnalyze}
          className="inline-flex items-center gap-1.5 rounded-[var(--r-md)] bg-accent px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Analyze sources →
        </button>
      </div>

      {props.error ? <p className="text-xs text-red-700">{props.error}</p> : null}

      {props.attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="attachments">
          {props.attachments.map((a) => (
            <span
              key={a.id}
              data-att-id={a.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink"
            >
              <span className="text-ink-muted">[{a.kind}]</span>
              {a.label}
              <button
                type="button"
                aria-label={`Remove ${a.label}`}
                onClick={() => props.onRemoveAttachment(a.id)}
                className="text-ink-muted hover:text-red-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
