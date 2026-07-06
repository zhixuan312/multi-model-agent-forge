'use client';

import { useState, useMemo, useRef, useEffect, type FormEvent, type ReactNode } from 'react';
import { Send, Mic, MicOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Textarea, Avatar } from '@/components/ui';
import { ProseBlock } from '@/components/patterns/prose-block';
import type { MemberRef } from '@/collab/types';

export interface ConversationMessage {
  id: string;
  sender: 'forge' | 'member';
  senderName?: string;
  bodyMd: string;
  timestamp?: Date;
  meta?: Record<string, unknown>;
}

export interface MessageProps {
  msg: ConversationMessage;
  renderMeta?: (msg: ConversationMessage) => ReactNode;
}

export function Message({ msg, renderMeta }: MessageProps) {
  return (
    <div
      data-sender={msg.sender}
      className={cn(
        'rounded-[var(--r-md)] px-3 py-2',
        msg.sender === 'forge' ? 'bg-surface-2 text-ink' : 'bg-accent-tint text-accent-deep',
      )}
    >
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {msg.senderName ?? (msg.sender === 'forge' ? 'Forge' : 'You')}
      </span>
      <ProseBlock variant="chat">{msg.bodyMd}</ProseBlock>
      {renderMeta ? renderMeta(msg) : null}
    </div>
  );
}

export interface MessageListProps {
  messages: ConversationMessage[];
  renderMeta?: (msg: ConversationMessage) => ReactNode;
  emptyText?: string;
  className?: string;
}

export function MessageList({ messages, renderMeta, emptyText, className }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      className={cn('flex flex-col gap-2 overflow-y-auto rounded-[var(--r-md)] border border-line bg-surface p-3', className)}
    >
      {messages.length === 0 ? (
        <p className="text-xs italic text-ink-faint">{emptyText ?? 'No messages yet.'}</p>
      ) : (
        messages.map((m) => <Message key={m.id} msg={m} renderMeta={renderMeta} />)
      )}
      <div ref={endRef} />
    </div>
  );
}

export interface ConversationComposerProps {
  onSend: (text: string) => void;
  placeholder?: string;
  submitLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  voice?: boolean;
  secondaryActions?: ReactNode;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
  /** Number of visible text rows (default 2). Set 0 for fill-height. */
  rows?: number;
  /** Controlled mode: supply value+onChange to manage state externally. */
  value?: string;
  onChange?: (v: string) => void;
  /** Members available for @-mention autocomplete. */
  mentionPool?: MemberRef[];
}

export function ConversationComposer({
  onSend,
  placeholder,
  submitLabel,
  disabled = false,
  loading = false,
  voice = false,
  secondaryActions,
  textareaRef,
  className,
  rows: rowsProp,
  value: controlledValue,
  onChange: controlledOnChange,
  mentionPool,
}: ConversationComposerProps) {
  const rows = rowsProp ?? 2;
  const fillHeight = rows === 0;
  const [internalValue, setInternalValue] = useState('');
  const controlled = controlledValue !== undefined;
  const value = controlled ? controlledValue : internalValue;
  const setVal = controlled ? (controlledOnChange ?? (() => {})) : setInternalValue;

  const internalRef = useRef<HTMLTextAreaElement>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recStartRef = useRef(0);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '' || disabled || loading) return;
    onSend(trimmed);
    if (!controlled) setInternalValue('');
  }

  async function toggleRecord(): Promise<void> {
    if (recording) { recorderRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/mp4';
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
          setVal(value ? `${value}\n${text}` : text);
        } catch { /* user can type instead */ }
        finally { setTranscribing(false); }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch { /* microphone unavailable */ }
  }

  const isVoiceBusy = recording || transcribing;

  // @-mention autocomplete
  const [caret, setCaret] = useState(0);
  const [mentionActive, setMentionActive] = useState(0);
  const mentionQuery = useMemo(() => {
    if (!mentionPool?.length) return null;
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\d.'-]*)$/u);
    return m ? m[1]! : null;
  }, [value, caret, mentionPool]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || !mentionPool) return [];
    const q = mentionQuery.toLowerCase();
    return mentionPool.filter((m) => m.displayName.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, mentionPool]);
  const mentionOpen = mentionMatches.length > 0;

  function syncCaret(): void {
    const el = (textareaRef as React.RefObject<HTMLTextAreaElement>)?.current ?? internalRef.current;
    setCaret(el?.selectionStart ?? value.length);
  }
  function chooseMention(m: MemberRef): void {
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = before.replace(/@([\p{L}\d.'-]*)$/u, `@${m.displayName} `);
    setVal(replaced + after);
    setMentionActive(0);
    requestAnimationFrame(() => {
      const el = (textareaRef as React.RefObject<HTMLTextAreaElement>)?.current ?? internalRef.current;
      if (!el) return;
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  return (
    <div className={cn('shrink-0 border-t border-line px-5 py-3', className)}>
      <form onSubmit={submit} className={cn('relative', fillHeight && 'flex min-h-0 flex-1 flex-col')}>
        {mentionOpen ? (
          <ul
            role="listbox"
            className="absolute bottom-full z-50 mb-1.5 max-h-56 w-64 overflow-y-auto rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
          >
            {mentionMatches.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === mentionActive}
                  onMouseEnter={() => setMentionActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); chooseMention(m); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left text-sm transition-colors',
                    i === mentionActive ? 'bg-surface-2 text-ink' : 'text-ink-soft',
                  )}
                >
                  <Avatar size="sm" name={m.displayName} tint={m.avatarTint} aria-hidden />
                  <span className="truncate">{m.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Textarea
          ref={textareaRef ?? internalRef}
          value={value}
          onChange={(e) => { setVal(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
          disabled={disabled || transcribing}
          placeholder={placeholder ?? 'Type your message…'}
          rows={fillHeight ? undefined : rows}
          className={cn('resize-none', fillHeight && 'min-h-0 flex-1', recording && 'border-[var(--rose)] ring-1 ring-[var(--rose)]/30')}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onKeyDown={(e) => {
            if (mentionOpen) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionActive((a) => (a + 1) % mentionMatches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMentionActive((a) => (a - 1 + mentionMatches.length) % mentionMatches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseMention(mentionMatches[mentionActive]!); return; }
              if (e.key === 'Escape') { e.preventDefault(); setCaret(-1); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />

        {recording ? (
          <div className="mt-2 flex items-center gap-2 text-xs font-medium text-[var(--rose)]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--rose)]" /> Recording...
          </div>
        ) : transcribing ? (
          <div className="mt-2 flex items-center gap-2 text-xs font-medium text-accent-deep">
            <Loader2 className="size-3.5 animate-spin" /> Transcribing...
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant={recording ? 'danger' : 'ghost'} onClick={toggleRecord} disabled={disabled || transcribing || !voice} leftIcon={recording ? <MicOff /> : <Mic />} type="button">
              {recording ? 'Stop' : 'Voice'}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {secondaryActions}
            <Button size="sm" type="submit" disabled={disabled || !value.trim() || isVoiceBusy} loading={loading} rightIcon={<Send />}>
              {submitLabel ?? 'Send'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export interface ConversationPaneProps {
  messages: ConversationMessage[];
  onSend: (text: string) => void;
  renderMeta?: (msg: ConversationMessage) => ReactNode;
  emptyText?: string;
  composerProps?: Partial<Omit<ConversationComposerProps, 'onSend'>>;
  className?: string;
}

export function ConversationPane({ messages, onSend, renderMeta, emptyText, composerProps, className }: ConversationPaneProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <MessageList messages={messages} renderMeta={renderMeta} emptyText={emptyText} className="min-h-0 flex-1" />
      <ConversationComposer onSend={onSend} {...composerProps} />
    </div>
  );
}
