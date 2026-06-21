'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Paperclip, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Textarea } from '@/components/ui';
import { pickRecorderMime } from '@/components/forge/BrainDumpComposer';

/**
 * ForgeComposer — the shared rich input used across all conversational surfaces.
 * Supports text, voice recording (transcribe via OpenAI), and file attachment.
 */

export interface ForgeComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  submitLabel?: string;
  disabled?: boolean;
  voiceEnabled?: boolean;
  /** Additional buttons to show in the action bar (e.g. "View spec"). */
  secondaryAction?: React.ReactNode;
}

export function ForgeComposer(props: ForgeComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recStartRef = useRef(0);

  // Scroll textarea to bottom when text is appended (voice transcription)
  const prevLength = useRef(props.value.length);
  useEffect(() => {
    if (props.value.length > prevLength.current && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
    prevLength.current = props.value.length;
  }, [props.value]);

  async function toggleRecord(): Promise<void> {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMime();
      const rec = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recStartRef.current = Date.now();
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        setRecording(false);
        setTranscribing(true);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const form = new FormData();
        form.append('file', blob, 'audio');
        form.append('durationMs', String(Date.now() - recStartRef.current));
        try {
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          if (!res.ok) throw new Error('Transcription failed.');
          const { text } = (await res.json()) as { text: string };
          props.onChange(props.value ? `${props.value}\n${text}` : text);
        } catch {
          // silently fail — user can type instead
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      // microphone unavailable
    }
  }

  function handleFile(file: File): void {
    // For now, read text files and append content
    if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.json') || file.name.endsWith('.csv')) {
      file.text().then((text) => {
        props.onChange(props.value ? `${props.value}\n\n--- ${file.name} ---\n${text}` : text);
      });
    }
  }

  return (
    <div className="shrink-0 border-t border-line px-5 py-3">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled || transcribing}
          placeholder={props.placeholder ?? 'Message Forge...'}
          rows={2}
          className={cn(
            'resize-none',
            recording && 'border-[var(--rose)] ring-1 ring-[var(--rose)]/30',
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); props.onSubmit(); }
          }}
        />
      </div>

      {/* Status indicators */}
      {recording ? (
        <div className="mt-2 flex items-center gap-2 text-xs font-medium text-[var(--rose)]">
          <span className="size-2 animate-pulse rounded-full bg-[var(--rose)]" />
          Recording...
        </div>
      ) : transcribing ? (
        <div className="mt-2 flex items-center gap-2 text-xs font-medium text-accent-deep">
          <Loader2 className="size-3.5 animate-spin" />
          Transcribing...
        </div>
      ) : null}

      {/* Action bar */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {props.voiceEnabled ? (
            <Button
              size="sm"
              variant={recording ? 'danger' : 'ghost'}
              onClick={toggleRecord}
              disabled={props.disabled || transcribing}
              leftIcon={recording ? <MicOff /> : <Mic />}
            >
              {recording ? 'Stop' : 'Voice'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fileInput.current?.click()}
            disabled={props.disabled}
            leftIcon={<Paperclip />}
          >
            File
          </Button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          {props.secondaryAction}
          <Button
            size="sm"
            onClick={props.onSubmit}
            disabled={props.disabled || !props.value.trim() || recording || transcribing}
            rightIcon={<ArrowRight />}
          >
            {props.submitLabel ?? 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
